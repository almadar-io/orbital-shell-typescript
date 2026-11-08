/**
 * The `os` ports of a kernel host, with no Node builtin in sight so the browser bundle can import them.
 * The only `os` answerer a host ships is the native add-on's `OsHost` (`orbital-core`'s `os_host`, behind `createNativeOsPort`);
 * a wasm kernel installs none, so every `os` ask is `unsupported`. The grant check is the Rust `OsGrants` (`allows` below), never TypeScript.
 */
import type { JsonValue } from '@almadar/core';
import type { CallSiteWire, OsError, OsOp, Settled } from '@almadar/core/kernel-wire';
import type { NativeOsHostClass, NativeOsServer } from './wire.js';

export type OsFsMode = 'read' | 'write' | 'create' | 'remove' | 'meta';
export type OsNetKind = 'tcp' | 'udp' | 'listen';
export type OsStdioKind = 'in' | 'out' | 'err';
export type OsSysKind = 'cpu' | 'memory' | 'disk' | 'network' | 'power-state' | 'identity';
export type OsDesktopKind = 'notify' | 'speak' | 'brightness' | 'volume' | 'power';

/** One thing an `os/` call needs from the program's grants: the JSON of Rust `OsRequirement`. */
export type OsRequirement =
  | { need: 'fs'; path: string; mode: OsFsMode }
  | { need: 'exec'; command: string }
  | { need: 'net'; host: string; port: number; kinds: OsNetKind[] }
  | { need: 'env'; name: string }
  | { need: 'stdio'; kind: OsStdioKind }
  | { need: 'sys'; kind: OsSysKind }
  | { need: 'desktop'; kind: OsDesktopKind };

/** The grant decisions the wasm kernel owns (`OsGrants::allows`, the one-grant glob matcher, `is_public_address`). */
export interface OsGrantPort {
  /** `OsGrants::allows` over the grants of `orbital` (its own plus the app level); with no orbital, the app level alone. */
  allows(need: OsRequirement, orbital?: string): boolean;
  /** Whether the absolute `glob` (`**`, `*`, `?`) matches `path`, as a one-grant `fs_allows` for read. */
  globMatches(glob: string, path: string): boolean;
  /** `is_public_address`: the rule an outbound host name must pass. */
  isPublicAddress(ip: string): boolean;
  /** Place the program's anchored grants and arguments under the host's anchors (`set_os_anchors_json`); answers what grants nothing. */
  anchor(anchors: OsAnchors): OsAnchorProblem[];
  /** An `os/` call's arguments with every anchored part replaced by what it names under the host's anchors (`resolve_anchored_args`). */
  resolveArgs(op: OsOp, args: JsonValue[]): Settled<JsonValue[], OsError>;
}

/** An anchored grant entry that grants nothing under the host's anchors. */
export interface OsAnchorProblem {
  path: string;
  message: string;
}

/** What a host answers an `os` ask with; `close` drops every handle it holds, as the native `OsHandles::close_all`. */
export interface OsHostPort {
  /** `orbital` is the orbital whose trait made the ask: its grants (plus the app's) answer it. */
  answer(op: OsOp, args: JsonValue[], orbital?: string): Promise<Settled<JsonValue, OsError>>;
  /**
   * `Completions::run_later`: a keyed ask of a completion-deferring op. A failed check (or a key already pending) is the
   * in-place `error`; `ok` means the work runs in the background and its outcome reaches `deliver` once, unless
   * the key is cancelled first. A host with no `defer` answers every ask in place.
   */
  defer?(op: OsOp, args: JsonValue[], key: string, site: CallSiteWire, deliver: (outcome: Settled<JsonValue, OsError>) => void, orbital?: string): Settled<null, OsError>;
  /**
   * A keyed stream (`OsOp::is_stream`, EXEC-QUEUE-12): the host binds and answers once in place, then hands each message
   * to `message` until it ends; `message` answers `false` when no one takes it any more. A failure after the answer
   * reaches `fail` once; any other end reaches `ended` once, with the call's final outcome (a stream that closes on a
   * success, for example stdin at end of file) or `null` when it ends with none. After `fail` or `ended` the key is closed. A host with no `stream` answers every stream ask in place, as unsupported.
   */
  stream?(op: OsOp, args: JsonValue[], key: string, site: CallSiteWire, message: (value: JsonValue) => boolean, fail: (error: OsError) => void, ended: (final: { ok: JsonValue } | null) => void, orbital?: string): Promise<Settled<JsonValue, OsError>>;
  /** `OsHandles::cancel_completion`: drop the pending completion of `key`, or stop its stream; `false` when none is open. */
  cancel?(key: string): boolean;
  close(): void;
}

/** The event a deferred `os` call's outcome fires on its call site, as the kernel shapes it. */
export interface OsCompletionEvent {
  event: string;
  payload: JsonValue;
}

/** What the wasm kernel decides about a deferred `os` call: which ops defer, and the event an outcome fires. */
export interface OsCompletionPort {
  defers(op: OsOp): boolean;
  streams(op: OsOp): boolean;
  event(site: CallSiteWire, key: string, outcome: Settled<JsonValue, OsError>): OsCompletionEvent | null;
}

/** The next step of a TLS operation the kernel parked on a deferred raw ask. */
export type OsTlsStep = { ask: { op: OsOp; args: JsonValue[] } } | { done: Settled<JsonValue, OsError> };

/** The kernel's TLS sockets (EXEC-HTTP-7): the host's raw outcome of a deferred ask goes in, the next raw ask or the program's outcome comes out. */
export interface OsTlsPort {
  /** `null` when `key` parks no TLS operation. */
  complete(key: string, outcome: Settled<JsonValue, OsError>): OsTlsStep | null;
}

/** The server handle's TLS export. */
export interface OsTlsKernel {
  tlsComplete(key: string, outcomeJson: string): string;
}

/** The TLS port over the kernel `Server` handle: every decision is `RuntimeKernel::tls_complete`. */
export function kernelOsTls(server: () => OsTlsKernel): OsTlsPort {
  return {
    complete: (key, outcome) => {
      const step: OsTlsStep | null = JSON.parse(server().tlsComplete(key, JSON.stringify(outcome)));
      return step;
    },
  };
}

/** The kernel exports the completion port is built from. */
export interface OsCompletionMatchers {
  osDeferringOps(): string;
  osStreamOps(): string;
  osCompletionEvent(siteJson: string, key: string, outcomeJson: string): string;
}

/** The completion port over the wasm kernel: `OsOp::defers_completion`, `OsOp::is_stream` and `completion_event`, not copied. */
export function kernelOsCompletions(kernel: OsCompletionMatchers): OsCompletionPort {
  const deferring: string[] = JSON.parse(kernel.osDeferringOps());
  const streaming: string[] = JSON.parse(kernel.osStreamOps());
  return {
    defers: (op) => deferring.includes(op),
    streams: (op) => streaming.includes(op),
    event: (site, key, outcome) => {
      const fired: OsCompletionEvent | null = JSON.parse(kernel.osCompletionEvent(JSON.stringify(site), key, JSON.stringify(outcome)));
      return fired;
    },
  };
}

/** The kernel pieces a grant port is built from: the `Server` handle holding the program's grants and the module-level matchers. */
export interface OsGrantKernel {
  osAllows(requirementJson: string, orbital?: string): boolean;
  setOsAnchors(anchorsJson: string): string;
  osResolveArgs(op: string, argsJson: string): string;
}

export interface OsGrantMatchers {
  osGlobMatches(glob: string, path: string): boolean;
  isPublicAddress(ip: string): boolean;
}

/** The grant port over the wasm kernel: every decision is `OsGrants::allows` and the exports beside it. */
export function kernelOsGrants(matchers: OsGrantMatchers, server: () => OsGrantKernel): OsGrantPort {
  return {
    allows: (need, orbital) => server().osAllows(JSON.stringify(need), orbital),
    globMatches: (glob, path) => matchers.osGlobMatches(glob, path),
    isPublicAddress: (ip) => matchers.isPublicAddress(ip),
    anchor: (anchors) => {
      const problems: OsAnchorProblem[] = JSON.parse(server().setOsAnchors(JSON.stringify(anchors)));
      return problems;
    },
    resolveArgs: (op, args) => {
      const resolved: Settled<JsonValue[], OsError> = JSON.parse(server().osResolveArgs(op, JSON.stringify(args)));
      return resolved;
    },
  };
}

/**
 * Where a host anchors `~/` and `./` paths and grants (the user's home and the directory it started the program in), and
 * what a grant's declared anchors resolve to: its executable's directory and its boot environment (`orbital-core` `OsAnchors`).
 */
export interface OsAnchors {
  readonly home?: string;
  readonly start?: string;
  readonly exeDir?: string;
  readonly exe?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** What a written path names under the host's anchors (`OsAnchors::expand`). */
export type AnchoredPath = { kind: 'plain' } | { kind: 'anchored'; path: string } | { kind: 'unknown'; message: string };

export function expandAnchor(anchors: OsAnchors, text: string): AnchoredPath {
  const home = text === '~' ? '' : text.startsWith('~/') ? text.slice(2) : undefined;
  const start = text === '.' ? '' : text.startsWith('./') ? text.slice(2) : undefined;
  const rest = home ?? start;
  if (rest === undefined) return { kind: 'plain' };
  const dir = home !== undefined ? anchors.home : anchors.start;
  if (dir === undefined) return { kind: 'unknown', message: `${text}: this host has no ${home !== undefined ? 'home' : 'start'} directory` };
  return { kind: 'anchored', path: rest === '' ? dir : `${dir.replace(/\/+$/, '')}/${rest}` };
}

/** `path` and, when it lies under the home or start directory, its `~/` and `./` forms (`OsAnchors::forms`). */
function anchoredForms(anchors: OsAnchors, path: string): string[] {
  const forms = [path];
  const under = (dir: string | undefined, prefix: string): void => {
    if (dir === undefined) return;
    const root = dir.replace(/\/+$/, '');
    if (path === root) forms.push(prefix);
    else if (path.startsWith(`${root}/`)) forms.push(`${prefix}${path.slice(root.length + 1)}`);
  };
  under(anchors.home, '~/');
  under(anchors.start, './');
  return forms;
}

/** The grant port a host checks absolute paths through: an fs need also matches the program's `~/` and `./` grants (`OsGrants::fs_allows_at`). */
export function anchoredGrants(grants: OsGrantPort, anchors: OsAnchors): OsGrantPort {
  return {
    ...grants,
    allows: (need, orbital) => (need.need === 'fs' ? anchoredForms(anchors, need.path).some((path) => grants.allows({ ...need, path }, orbital)) : grants.allows(need, orbital)),
  };
}

type NativeListener =
  | { kind: 'defer'; deliver: (outcome: Settled<JsonValue, OsError>) => void }
  | { kind: 'stream'; message: (value: JsonValue) => boolean; fail: (error: OsError) => void; ended: (final: { ok: JsonValue } | null) => void };

type NativeAnswer = Settled<JsonValue, OsError> | { deferred: true };

/**
 * The `os` port over the native add-on's `OsHost`: the kernel's `os_host` answers every ask in Rust, under the grants
 * `server()` holds; this routes each completion the add-on reports to the call that asked for it. `anchors` is where `~/`
 * and `./` resolve, handed to the add-on and to each server handle the first time it answers.
 */
export function createNativeOsPort(host: NativeOsHostClass, anchors: OsAnchors, server: () => NativeOsServer): OsHostPort {
  const anchorsJson = JSON.stringify(anchors);
  const listeners = new Map<string, NativeListener>();
  const anchored = new WeakSet<NativeOsServer>();
  const serverOf = (): NativeOsServer => {
    const handle = server();
    if (!anchored.has(handle)) {
      handle.setOsAnchors(anchorsJson);
      anchored.add(handle);
    }
    return handle;
  };
  const failure = (cause: unknown): { error: OsError } => ({ error: { kind: 'invalid', message: cause instanceof Error ? cause.message : String(cause) } });
  const native = new host(anchorsJson, (key, kind, json) => {
    const listener = listeners.get(key);
    if (listener === undefined) return;
    if (kind === 'ended') {
      listeners.delete(key);
      if (listener.kind === 'stream') listener.ended(null);
      return;
    }
    const settled: Settled<JsonValue, OsError> = JSON.parse(json);
    if (listener.kind === 'defer') {
      listeners.delete(key);
      listener.deliver(settled);
    } else if (kind === 'message' && 'ok' in settled) {
      if (!listener.message(settled.ok)) {
        listeners.delete(key);
        native.cancel(key);
      }
    } else if (kind === 'complete') {
      listeners.delete(key);
      if ('error' in settled) listener.fail(settled.error);
      else listener.ended(settled);
    }
  });
  const keyed = (op: OsOp, args: JsonValue[], key: string, site: CallSiteWire, orbital: string | undefined): NativeAnswer => {
    const answered: NativeAnswer = JSON.parse(native.answerKeyed(serverOf(), op, JSON.stringify(args), key, JSON.stringify(site), orbital));
    return answered;
  };
  return {
    answer: async (op, args, orbital) => {
      try {
        const answered: Settled<JsonValue, OsError> = JSON.parse(native.answer(serverOf(), op, JSON.stringify(args), orbital));
        return answered;
      } catch (cause) {
        return failure(cause);
      }
    },
    defer: (op, args, key, site, deliver, orbital) => {
      listeners.set(key, { kind: 'defer', deliver });
      try {
        const answered = keyed(op, args, key, site, orbital);
        if ('deferred' in answered) return { ok: null };
        listeners.delete(key);
        if ('error' in answered) return answered;
        queueMicrotask(() => deliver(answered));
        return { ok: null };
      } catch (cause) {
        listeners.delete(key);
        return failure(cause);
      }
    },
    stream: async (op, args, key, site, message, fail, ended, orbital) => {
      listeners.set(key, { kind: 'stream', message, fail, ended });
      try {
        const answered = keyed(op, args, key, site, orbital);
        if ('deferred' in answered) return { ok: null };
        if ('error' in answered) listeners.delete(key);
        return answered;
      } catch (cause) {
        listeners.delete(key);
        return failure(cause);
      }
    },
    cancel: (key) => {
      listeners.delete(key);
      return native.cancel(key);
    },
    close: () => {
      listeners.clear();
      native.close();
    },
  };
}
