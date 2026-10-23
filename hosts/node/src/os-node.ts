/**
 * The Node answerer of the kernel's `os` asks: the fs, process and net families on Node `fs`, `child_process`,
 * `net`, `dgram` and `dns`, with the native host's answer shapes, error kinds, timeouts and handle model
 * (`orbital-core` `os_host`). It holds no logic beyond the raw port: every grant decision is the kernel's,
 * reached through `OsGrantPort`. Import it only from a Node entry point (`@almadar/runtime/kernelOsNode`); the
 * browser bundle never carries it.
 */
import type { JsonValue } from '@almadar/core';
import type { OsError, OsOp, Settled } from '@almadar/core/kernel-wire';
import { FsOps, isFsOp } from './os-node-fs.js';
import { isNetOp, NetOps } from './os-node-net.js';
import { isProcessOp, ProcessOps } from './os-node-process.js';
import { isSysOp, SysOps } from './os-node-sys.js';
import { invalid, osFailure, OsFailure, OsState, type Deferral } from './os-node-support.js';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { createLogger } from '@almadar/logger';
import { anchoredGrants, type OsAnchors, type OsGrantPort, type OsHostPort } from '@almadar/shell-runtime';


const log = createLogger('almadar:host:os');

function failureOf(op: OsOp, raised: unknown): OsError {
  if (raised instanceof OsFailure) return raised.error;
  return { kind: 'io', message: `${op}: ${raised instanceof Error ? raised.message : String(raised)}` };
}

class NodeOsHost implements OsHostPort {
  private readonly state: OsState;
  private readonly fs: FsOps;
  private readonly process: ProcessOps;
  private readonly net: NetOps;
  private readonly sys: SysOps;
  private placed = false;
  /** The listener handle of each open stream, by its key. */
  private readonly streams = new Map<string, number>();

  constructor(private readonly given: OsGrantPort, private readonly anchors: OsAnchors) {
    this.state = new OsState(anchors);
    const grants = anchoredGrants(given, anchors);
    this.fs = new FsOps(this.state, grants);
    this.process = new ProcessOps(this.state, grants);
    this.net = new NetOps(this.state, grants);
    this.sys = new SysOps(grants);
  }

  /** The call's arguments with every anchored part resolved by the kernel, the program's anchors placed on the first call. */
  private resolved(op: OsOp, args: JsonValue[]): JsonValue[] {
    if (!this.placed) {
      for (const problem of this.given.anchor(this.anchors)) log.warn('anchor:grants-nothing', { at: problem.path, message: problem.message });
      this.placed = true;
    }
    const resolved = this.given.resolveArgs(op, args);
    if ('error' in resolved) throw new OsFailure(resolved.error);
    return resolved.ok;
  }

  private async dispatch(op: OsOp, given: JsonValue[]): Promise<JsonValue> {
    const args = this.resolved(op, given);
    if (op === 'os/close') {
      if (this.fs.closeOwned(args) || this.net.closeOwned(args)) return {};
      throw osFailure('closed', op, 'not an open handle');
    }
    if (isFsOp(op)) return this.fs.run(op, args);
    if (isProcessOp(op)) return this.process.run(op, args);
    if (isNetOp(op)) return this.net.run(op, args);
    if (isSysOp(op)) return this.sys.run(op);
    throw osFailure('unsupported', op, 'this host does not implement the operation yet');
  }

  async answer(op: OsOp, args: JsonValue[]): Promise<Settled<JsonValue, OsError>> {
    try {
      return { ok: await this.dispatch(op, args) };
    } catch (raised) {
      return { error: failureOf(op, raised) };
    }
  }

  private deferral(op: OsOp, args: JsonValue[]): Deferral {
    switch (op) {
      case 'os/wait':
        return this.process.waitLater(args);
      case 'os/read':
        return this.fs.readLater(op, args);
      case 'os/send':
        return this.net.sendLater(op, args);
      case 'os/recv':
        return this.net.recvLater(op, args);
      case 'os/recvfrom':
        return this.net.recvfromLater(op, args);
      default:
        throw osFailure('unsupported', op, 'this operation does not defer its completion');
    }
  }

  /** `Completions::run_later`: the checks fail in place, the wait runs in the background and its outcome goes to `deliver` unless the key is cancelled first. */
  defer(op: OsOp, args: JsonValue[], key: string, deliver: (outcome: Settled<JsonValue, OsError>) => void): Settled<null, OsError> {
    let blocking: Deferral;
    try {
      blocking = this.deferral(op, this.resolved(op, args));
    } catch (raised) {
      return { error: failureOf(op, raised) };
    }
    if (!this.state.completions.begin(key)) return { error: failureOf(op, invalid(op, `key ${key} already has a completion pending`)) };
    const finish = (build: () => JsonValue): void => {
      if (!this.state.completions.claim(key)) return;
      try {
        deliver({ ok: build() });
      } catch (raised) {
        deliver({ error: failureOf(op, raised) });
      }
    };
    blocking().then(finish, (raised: unknown) => finish(() => { throw raised; }));
    return { ok: null };
  }

  /** A keyed stream (EXEC-QUEUE-12): `os/tcp-listen` binds and answers in place, then each connection reaches `message`. */
  async stream(op: OsOp, args: JsonValue[], key: string, message: (value: JsonValue) => boolean, fail: (error: OsError) => void): Promise<Settled<JsonValue, OsError>> {
    try {
      if (op !== 'os/tcp-listen') throw osFailure('unsupported', op, 'this host streams only os/tcp-listen');
      if (this.streams.has(key)) throw invalid(op, `key ${key} already has a stream open`);
      const answer = await this.net.listen(op, this.resolved(op, args), message, (error) => {
        this.streams.delete(key);
        fail(error);
      });
      this.streams.set(key, answer.sock);
      return { ok: answer };
    } catch (raised) {
      return { error: failureOf(op, raised) };
    }
  }

  cancel(key: string): boolean {
    const listener = this.streams.get(key);
    if (listener !== undefined) {
      this.streams.delete(key);
      this.net.stopListening(listener);
      return true;
    }
    return this.state.completions.cancel(key);
  }

  close(): void {
    this.state.close();
  }
}

/** One program instance's `os` host: its own handle tables, closed by `close`. */
export interface NodeOsHostOptions {
  /** Where `~/` and `./` and the declared grant anchors are placed; absent, the process's own (`OsAnchors::of_process`). */
  anchors?: OsAnchors;
}

/** The process's home, working directory, executable directory and environment, read once (`OsAnchors::of_process`). */
export function processAnchors(): OsAnchors {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
  return { home: homedir(), start: process.cwd(), exeDir: dirname(process.execPath), env };
}

export function createNodeOsHost(grants: OsGrantPort, options: NodeOsHostOptions = {}): OsHostPort {
  return new NodeOsHost(grants, options.anchors ?? processAnchors());
}
