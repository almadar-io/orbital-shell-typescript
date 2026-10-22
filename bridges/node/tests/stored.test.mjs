// The Node add-on over the memory store produces the trace the Rust golden pins (the Python extension pins the same file).
// Run: ORBITAL_KERNEL_NODE=<path to kernel.node> node --test crates/orbital-shell-typescript/bridges/node/tests/stored.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'stored');
const { Server, NativeServer } = createRequire(import.meta.url)(process.env.ORBITAL_KERNEL_NODE);
const schema = readFileSync(join(fixtures, 'notes.schema.json'), 'utf8');
const save = JSON.stringify({ event: 'SAVE', targetTrait: 'Draft' });
const memory = JSON.stringify({ DATA_BACKEND: 'mock', NODE_ENV: 'development' });

test('the memory store trace is the shared golden', () => {
  const server = Server.withStore(schema, memory);
  const trace = { start: JSON.parse(server.start('Main', save)), state: server.getState('Draft'), inFlight: server.inFlight() };
  assert.deepEqual(trace, JSON.parse(readFileSync(join(fixtures, 'notes.trace.json'), 'utf8')));
});

test('control: the plain server leaves the row ask to the host', () => {
  const waiting = JSON.parse(new Server(schema).start('Main', save));
  assert.equal(waiting.status, 'await');
  assert.deepEqual(waiting.requests.map((r) => r.request.kind), ['readRow']);
});

test('control: production refuses the memory store', () => {
  assert.throws(() => Server.withStore(schema, JSON.stringify({ DATA_BACKEND: 'mock' })), /not permitted/);
});

const desk = JSON.stringify({
  name: 'Desk',
  inbound: ['ping'],
  orbitals: [{
    name: 'Desk',
    entity: { name: 'Note', persistence: 'persistent', collection: 'notes', fields: [{ name: 'id', type: 'string' }] },
    traits: [{
      name: 'Notes',
      linkedEntity: 'Note',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [
          { key: 'ADD', name: 'Add', external: true },
          { key: 'PING', name: 'Ping', inbound: { name: 'ping', answers: 'PONG' } },
          { key: 'PONG', name: 'Pong' },
        ],
        transitions: [
          { from: 'idle', to: 'idle', event: 'ADD' },
          { from: 'idle', to: 'idle', event: 'PING', effects: [['emit', 'PONG', { status: 202, body: 'pong' }]] },
        ],
      },
      emits: [{ event: 'PONG' }],
    }],
  }],
});

test('the retired native HTTP adapter reports its explicit unavailable contract', () => {
  assert.throws(() => NativeServer.open(desk, memory, '{}', null), /NATIVE_SERVER_UNAVAILABLE/);
});
