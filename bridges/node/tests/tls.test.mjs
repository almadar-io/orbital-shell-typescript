// EXEC-HTTP-7 on the native Node add-on: the kernel owns TLS on os/* sockets; this host answers only raw bytes.
// Twin of the kernel::tls_sockets tests of orbital-core-runtime (same cases, a real TLS server on loopback).
// Run from the repository root (the operator table is found from the working directory):
//   ORBITAL_KERNEL_NODE=<path to kernel.node> node --test crates/orbital-shell-typescript/bridges/node/tests/tls.test.mjs
import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const testdata = join(here, '../../../../orbital-core/crates/runtime/src/drivers/tls/testdata');
const certDer = readFileSync(join(testdata, 'cert.der'));
const keyDer = readFileSync(join(testdata, 'key.der'));
const certPem = new X509Certificate(certDer).toString();
const keyPem = createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8' }).export({ format: 'pem', type: 'pkcs8' });
const NOW_MS = (1_792_209_645 + 55) * 1000;
const { Server } = createRequire(import.meta.url)(process.env.ORBITAL_KERNEL_NODE);

let listener;
let port;
before(async () => {
  listener = tls.createServer({ cert: certPem, key: keyPem, ALPNProtocols: ['http/1.1'] }, (socket) => {
    let received = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.toString() === 'ping') socket.write('pong');
    });
    socket.on('error', () => undefined);
  });
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  port = listener.address().port;
});
after(() => listener.close());

const b64 = (text) => Buffer.from(text).toString('base64');
const routes = (ok) => ({ emit: { success: ok, failure: 'BAD' } });

function schema(go, chain, grantedHost = 'localhost') {
  const transitions = [{ from: 'idle', to: 'idle', event: 'GO', effects: go }];
  for (const [event, effects] of chain) transitions.push({ from: 'idle', to: 'idle', event, effects });
  for (const event of ['CLOSED', 'BAD', 'SENT', 'GOT', 'MORE']) if (!chain.some(([name]) => name === event)) transitions.push({ from: 'idle', to: 'idle', event });
  return JSON.stringify({
    name: 'App', typeContractVersion: 1,
    osGrants: { net: [{ target: `${grantedHost}:${port}`, kinds: ['tcp'] }] },
    orbitals: [{ name: 'Main', entity: { name: 'Job', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      traits: [{ name: 'Host', linkedEntity: 'Job', stateMachine: { states: [{ name: 'idle', isInitial: true }], transitions } }] }],
  });
}

/** The raw side of a host: real sockets, no TLS. */
class RawHost {
  constructor(deferRecv = false) {
    this.sockets = new Map();
    this.next = 5;
    this.rawSent = [];
    this.deferRecv = deferRecv;
    this.deferred = [];
  }

  async os(op, args) {
    if (op === 'os/tcp-connect') {
      const socket = net.connect(args[1], '127.0.0.1');
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
      const entry = { socket, chunks: [], ended: false, waiting: [] };
      socket.on('data', (chunk) => { entry.chunks.push(chunk); entry.waiting.splice(0).forEach((wake) => wake()); });
      socket.on('end', () => { entry.ended = true; entry.waiting.splice(0).forEach((wake) => wake()); });
      socket.on('error', () => { entry.ended = true; entry.waiting.splice(0).forEach((wake) => wake()); });
      const id = this.next++;
      this.sockets.set(id, entry);
      return { ok: { sock: id } };
    }
    const entry = this.sockets.get(args[0]);
    if (entry === undefined) return { error: { kind: 'closed', message: 'not an open socket' } };
    if (op === 'os/send') {
      const bytes = Buffer.from(args[1], 'base64');
      this.rawSent.push(bytes);
      await new Promise((resolve) => entry.socket.write(bytes, resolve));
      return { ok: { bytes: bytes.length } };
    }
    if (op === 'os/recv') {
      while (entry.chunks.length === 0 && !entry.ended) await new Promise((wake) => { entry.waiting.push(wake); setTimeout(wake, 2000); });
      if (entry.chunks.length === 0) return { ok: { data: '', eof: true } };
      const data = Buffer.concat(entry.chunks.splice(0));
      return { ok: { data: data.toString('base64'), eof: false } };
    }
    if (op === 'os/close') { entry.socket.destroy(); this.sockets.delete(args[0]); return { ok: {} }; }
    return { error: { kind: 'unsupported', message: op } };
  }

  async answer(request) {
    if (request.kind === 'random') return { kind: 'random', result: { ok: randomBytes(request.bytes).toString('base64') } };
    if (request.kind === 'clock') return { kind: 'clock', result: { ok: NOW_MS } };
    if (request.kind === 'readRow') return { kind: 'row', result: { error: 'no row' } };
    if (request.kind === 'os') {
      if (this.deferRecv && request.op === 'os/recv' && request.key !== undefined && request.site !== undefined) {
        this.deferred.push(request);
        return { kind: 'serviceDeferred' };
      }
      return { kind: 'os', result: await this.os(request.op, request.args) };
    }
    throw new Error(`unexpected ask ${request.kind}`);
  }

  close() { for (const { socket } of this.sockets.values()) socket.destroy(); }
}

async function run(server, host, event = 'GO') {
  let progress = JSON.parse(server.start('Main', JSON.stringify({ event, targetTrait: 'Host' })));
  while (progress.status === 'await') {
    const replies = [];
    for (const pending of progress.requests) replies.push({ id: pending.id, answer: await host.answer(pending.request) });
    progress = JSON.parse(server.resume(progress.flight, JSON.stringify(replies)));
  }
  assert.equal(progress.status, 'done');
  return progress.response;
}

const emitted = (response, event) => response.emittedEvents.find((e) => e.event === event)?.payload;
const pem = () => certPem;
const connect = (tlsArg) => ['os/tcp-connect', 'localhost', port, tlsArg, routes('CONNECTED')];
const chain = [
  ['CONNECTED', [['os/send', 5, b64('ping'), routes('SENT')]]],
  ['SENT', [['os/recv', 5, 4096, routes('GOT')]]],
  ['GOT', [['os/close', 5, routes('CLOSED')]]],
];

test('connect, send, recv and close carry plaintext to the program and only ciphertext to the raw host', async () => {
  const server = new Server(schema([connect({ serverName: 'localhost', ca: pem(), alpn: ['http/1.1'] })], chain));
  const host = new RawHost();
  const response = await run(server, host);
  assert.deepEqual(emitted(response, 'CONNECTED'), { sock: 5, alpn: 'http/1.1' });
  assert.deepEqual(emitted(response, 'SENT'), { bytes: 4 });
  assert.equal(Buffer.from(emitted(response, 'GOT').data, 'base64').toString(), 'pong');
  assert.ok(emitted(response, 'CLOSED') !== undefined);
  assert.ok(host.rawSent.every((raw) => !raw.includes('ping')), 'the host never sees the plaintext');
  assert.equal(host.rawSent[0][0], 0x16, 'the first raw bytes are a TLS handshake record');
  host.close();
});

test('control: a plain socket hands the host the program\'s own bytes', async () => {
  const server = new Server(schema([['os/tcp-connect', 'localhost', port, routes('CONNECTED')]], chain.slice(0, 1)));
  const host = new RawHost();
  await run(server, host);
  assert.ok(host.rawSent.some((raw) => raw.toString() === 'ping'));
  host.close();
});

test('a certificate the roots do not vouch for answers kind tls and closes the socket', async () => {
  const server = new Server(schema([connect({ serverName: 'localhost' })], chain));
  const host = new RawHost();
  const response = await run(server, host);
  assert.equal(emitted(response, 'BAD').kind, 'tls');
  assert.equal(emitted(response, 'CONNECTED'), undefined);
  assert.equal(host.sockets.size, 0, 'the failed handshake closed the raw socket');
  host.close();
});

test('a server name no net grant names is denied before any raw ask', async () => {
  const server = new Server(schema([connect({ serverName: 'elsewhere.example', ca: pem() })], chain));
  const host = new RawHost();
  const response = await run(server, host);
  assert.equal(emitted(response, 'BAD').kind, 'denied');
  assert.equal(host.next, 5, 'nothing connected');
  host.close();
});

test('a parked recv and a send run together, and the kernel finishes the recv from the host\'s raw bytes', async () => {
  const recv = ['os/recv', 5, 4096, { key: 'r1', emit: { success: 'GOT', failure: 'BAD' } }];
  const server = new Server(schema([connect({ serverName: 'localhost', ca: pem() })], [
    ['CONNECTED', [recv, ['os/send', 5, b64('ping'), routes('SENT')]]],
  ]));
  const host = new RawHost(true);
  const response = await run(server, host);
  assert.deepEqual(emitted(response, 'SENT'), { bytes: 4 }, 'the send completed while the recv was parked');
  assert.equal(emitted(response, 'GOT'), undefined, 'a deferring ask fires no route in its own dispatch');
  assert.equal(host.deferred.length, 1);
  const parked = host.deferred[0];
  let outcome = await host.os(parked.op, parked.args);
  let step = JSON.parse(server.tlsComplete(parked.key, JSON.stringify(outcome)));
  while (step !== null && step.ask !== undefined) {
    outcome = await host.os(step.ask.op, step.ask.args);
    step = JSON.parse(server.tlsComplete(parked.key, JSON.stringify(outcome)));
  }
  assert.equal(Buffer.from(step.done.ok.data, 'base64').toString(), 'pong');
  assert.equal(server.tlsComplete(parked.key, JSON.stringify(outcome)), 'null', 'control: a key parks one operation');
  host.close();
});
