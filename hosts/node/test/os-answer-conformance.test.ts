/**
 * Twin of the Rust os host's `every_os_answer_has_the_success_shape_the_operator_table_declares`: every os answer the
 * Node host gives has the success shape the installed operator table declares for it (no undeclared field, every
 * declared non-optional field present, each of its declared type), and every operator that declares a payload is
 * either run here or excused with its reason (G-ORBITAL-CORE-075).
 */
import { createSocket } from 'node:dgram';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { JsonValue } from '@almadar/core';
import { readLanguageBundle } from '@almadar/core/language-data';
import { createNodeOsHost } from '../src/os-node.js';

type JsonObject = { [key: string]: JsonValue };

const isRecord = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

const NOT_RUN: ReadonlyArray<readonly [string, string]> = [
  ['os/watch-files', 'a stream the host does not implement (G-ORB-307)'],
  ['os/watch-process', 'a stream the host does not implement (G-ORB-307)'],
  ['os/watch-signal', 'a stream the host does not implement (G-ORB-307)'],
  ['os/watch-env', 'a stream the host does not implement (G-ORB-307)'],
  ['os/watch-port', 'a stream the host does not implement (G-ORB-307)'],
  ['os/watch-cron', 'a stream the host does not implement (G-ORB-307)'],
  ['os/stdin-read', 'reads the test process\'s own stdin'],
  ['os/stdout-write', 'writes the test process\'s own stdout'],
  ['os/stderr-write', 'writes the test process\'s own stderr'],
  ['os/isatty', 'depends on how the test process is attached'],
  ['os/tty-size', 'needs a terminal'],
  ['os/tcp-listen', 'a stream: its first answer arrives through the stream callback (os-asks.json)'],
  ['os/tls-upgrade', 'a kernel op: the kernel answers it and a host implements no TLS'],
  ['os/fetch', 'a browser host performs it; this host refuses it typed (node-host-ports.test.ts)'],
  ['os/dns-resolve', 'needs a resolver'],
  ['os/mmio-read', 'no devices on this host'],
  ['os/mmio-write', 'no devices on this host'],
  ['os/irq-wait', 'no devices on this host'],
  ['os/irq-ack', 'no devices on this host'],
  ['os/current-exe', 'the Node host does not answer it (G-ORB-308)'],
  ['os/group-of', 'the Node host does not answer it (G-ORB-308)'],
];

function declaredOf(): Map<string, { fields: JsonObject; optional: ReadonlySet<string> }> {
  const bundle = readLanguageBundle(process.cwd()).std.operators;
  const table = isRecord(bundle) && isRecord(bundle.operators) ? bundle.operators : isRecord(bundle) ? bundle : {};
  const declared = new Map<string, { fields: JsonObject; optional: ReadonlySet<string> }>();
  for (const [name, operator] of Object.entries(table)) {
    if (!name.startsWith('os/') || !isRecord(operator) || !isRecord(operator.effect)) continue;
    const produces = operator.effect.produces;
    if (!isRecord(produces) || produces.kind !== 'object' || !isRecord(produces.fields)) continue;
    const optional = Array.isArray(produces.optional) ? produces.optional.filter((item): item is string => typeof item === 'string') : [];
    declared.set(name, { fields: produces.fields, optional: new Set(optional) });
  }
  return declared;
}

function fits(declared: JsonValue, value: JsonValue): boolean {
  const kind = typeof declared === 'string' ? declared : isRecord(declared) && typeof declared.kind === 'string' ? declared.kind : '';
  switch (kind) {
    case 'string':
    case 'bytes':
      return typeof value === 'string';
    case 'number':
    case 'int':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
    default:
      throw new Error(`the conformance check does not know the declared type ${JSON.stringify(declared)}`);
  }
}

function assertTableShape(op: string, answer: JsonValue, shape: { fields: JsonObject; optional: ReadonlySet<string> }): void {
  if (!isRecord(answer)) throw new Error(`${op} answered ${JSON.stringify(answer)}, not an object`);
  for (const [name, value] of Object.entries(answer)) {
    const declared = shape.fields[name];
    if (declared === undefined) throw new Error(`${op} answered the undeclared field ${name}`);
    if (!fits(declared, value)) throw new Error(`${op}: ${name} is declared ${JSON.stringify(declared)} but answered ${JSON.stringify(value)}`);
  }
  for (const name of Object.keys(shape.fields)) {
    if (name === 'key' || shape.optional.has(name)) continue;
    if (answer[name] === undefined) throw new Error(`${op} did not answer the declared field ${name}`);
  }
}

describe('the Node os host answers the shapes the operator table declares', () => {
  const table = declaredOf();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'os-conformance-')));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('the check refuses an undeclared field, a missing field and a field of the wrong type', () => {
    const pid = table.get('os/pid');
    if (pid === undefined) throw new Error('os/pid declares no payload');
    expect(() => assertTableShape('os/pid', { pid: 1, extra: 2 }, pid)).toThrow('undeclared field');
    expect(() => assertTableShape('os/pid', {}, pid)).toThrow('did not answer the declared field');
    expect(() => assertTableShape('os/pid', { pid: '1' }, pid)).toThrow('is declared');
    expect(() => assertTableShape('os/pid', { pid: 1 }, pid)).not.toThrow();
  });

  it('every os answer has the declared success shape, and every declared payload is run or excused', async () => {
    const host = createNodeOsHost({ allows: () => true, globMatches: () => false, isPublicAddress: () => false, anchor: () => [], resolveArgs: (_op, args) => ({ ok: args }) });
    const ran = new Set<string>();
    const run = async (op: string, args: JsonValue[]): Promise<JsonObject> => {
      const settled = await host.answer(op, args);
      if ('error' in settled) throw new Error(`${op} failed: ${JSON.stringify(settled.error)}`);
      const shape = table.get(op);
      if (shape === undefined) throw new Error(`${op} declares no success payload`);
      assertTableShape(op, settled.ok, shape);
      ran.add(op);
      if (!isRecord(settled.ok)) throw new Error(`${op} answered a non-object`);
      return settled.ok;
    };
    const peers: Array<{ destroy(): void }> = [];
    const server: Server = createServer((peer) => { peers.push(peer); peer.write('pong'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = address !== null && typeof address === 'object' ? address.port : 0;
    try {
      const [a, copy, moved, hard, soft, sub] = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 's.lnk', 'sub'].map((name) => join(dir, name));
      await run('os/write-file', [a, 'aGVsbG8=']);
      await run('os/append-file', [a, 'IQ==']);
      await run('os/read-file', [a]);
      const opened = await run('os/open', [a, 'r+']);
      const fd = opened.fd;
      await run('os/read', [fd, 2]);
      await run('os/seek', [fd, 0, 'set']);
      await run('os/write', [fd, 'eA==']);
      await run('os/fsync', [fd]);
      await run('os/close', [fd]);
      await run('os/truncate', [a, 3]);
      await run('os/copy', [a, copy]);
      await run('os/rename', [copy, moved]);
      await run('os/link', [a, hard]);
      await run('os/symlink', [a, soft]);
      await run('os/readlink', [soft]);
      await run('os/mkdir', [sub]);
      await run('os/list-dir', [dir]);
      await run('os/glob', [`${dir}/*.txt`]);
      await run('os/mktemp', ['tmp-', dir]);
      await run('os/realpath', [a]);
      await run('os/stat', [a]);
      await run('os/lstat', [soft]);
      await run('os/access', [a]);
      await run('os/exists', [a]);
      await run('os/chmod', [a, 420]);
      const uid = (await run('os/uid', [])).uid;
      const gid = (await run('os/gid', [])).gid;
      await run('os/chown', [a, uid, gid]);
      await run('os/utimes', [a, 1000, 2000]);
      await run('os/chdir', [dir]);
      await run('os/cwd', []);
      for (const path of [moved, hard, soft]) await run('os/remove', [path]);
      await run('os/rmdir', [sub]);

      await run('os/pid', []);
      await run('os/ppid', []);
      await run('os/setenv', ['ORB_CONFORMANCE_X', '1']);
      await run('os/getenv', ['ORB_CONFORMANCE_X']);
      await run('os/unsetenv', ['ORB_CONFORMANCE_X']);
      expect(await run('os/getenv', ['ORB_CONFORMANCE_X'])).toEqual({});
      await run('os/environ', []);
      const spawned = await run('os/spawn', ['/bin/sh', ['-c', 'exit 3'], {}]);
      await run('os/wait', [spawned.pid]);
      const sleeper = await run('os/spawn', ['/bin/sh', ['-c', 'exec sleep 30'], {}]);
      await run('os/kill', [sleeper.pid, 'TERM']);
      const killed = await run('os/wait', [sleeper.pid]);
      expect(killed.signal).toBe(15);

      await run('os/clock-monotonic', []);
      await run('os/username', []);

      const connected = await run('os/tcp-connect', ['127.0.0.1', port]);
      const sock = connected.sock;
      await run('os/send', [sock, 'cGluZw==']);
      await run('os/recv', [sock, 16]);
      await run('os/shutdown', [sock]);
      await run('os/close', [sock]);
      const left = await run('os/udp-bind', ['127.0.0.1', 0]);
      const probe = createSocket('udp4');
      const rightPort = await new Promise<number>((resolve) => probe.bind(0, '127.0.0.1', () => resolve(probe.address().port)));
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      const right = await run('os/udp-bind', ['127.0.0.1', rightPort]);
      expect(typeof left.sock).toBe('number');
      await run('os/sendto', [left.sock, 'cGluZw==', '127.0.0.1', rightPort]);
      await run('os/recvfrom', [right.sock, 16]);

      const excused = new Set(NOT_RUN.map(([name]) => name));
      expect([...ran].filter((name) => excused.has(name))).toEqual([]);
      expect(new Set([...ran, ...excused])).toEqual(new Set(table.keys()));
    } finally {
      for (const peer of peers) peer.destroy();
      server.close();
      host.close();
    }
  });
});
