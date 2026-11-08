// G-ORB-308: the native add-on answers `os/` asks itself, in Rust (orbital-core's `os_host`), under the program's grants.
// Run from the repository root (the operator table is found from the working directory):
//   ALMADAR_KERNEL_NODE=<path to kernel.node> node --test crates/orbital-shell-typescript/bridges/node/tests/os.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const { Server, OsHost } = createRequire(import.meta.url)(process.env.ALMADAR_KERNEL_NODE);

const root = realpathSync(mkdtempSync(join(tmpdir(), 'os-host-')));
const granted = join(root, 'granted');
const refused = join(root, 'refused');
mkdirSync(granted);
mkdirSync(refused);
writeFileSync(join(granted, 'a.txt'), 'a');
writeFileSync(join(refused, 'b.txt'), 'b');

const routes = (ok) => ({ emit: { success: ok, failure: 'BAD' } });
const site = { trait: 'Host', followOn: false, emit: { success: 'DONE', failure: 'BAD' } };

function schema(effects) {
  return JSON.stringify({
    name: 'App', typeContractVersion: 1,
    osGrants: { fs: [{ glob: `${granted}/**`, modes: ['read', 'meta'] }] },
    orbitals: [{ name: 'Main', entity: { name: 'Job', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      traits: [{ name: 'Host', linkedEntity: 'Job', stateMachine: { states: [{ name: 'idle', isInitial: true }], transitions: [
        { from: 'idle', to: 'idle', event: 'GO', effects },
        { from: 'idle', to: 'idle', event: 'DONE' },
        { from: 'idle', to: 'idle', event: 'BAD' },
      ] } }] }],
  });
}

const hosts = [];
function osHost(completions = []) {
  const host = new OsHost(JSON.stringify({ home: root, start: root, env: {} }), (key, kind, json) => completions.push({ key, kind, outcome: JSON.parse(json) }));
  hosts.push(host);
  return host;
}
after(() => hosts.forEach((host) => host.close()));

async function run(server, host) {
  let progress = JSON.parse(server.start('Main', JSON.stringify({ event: 'GO', targetTrait: 'Host' })));
  while (progress.status === 'await') {
    const replies = progress.requests.map(({ id, request }) => {
      assert.equal(request.kind, 'os', `unexpected ask ${request.kind}`);
      return { id, answer: { kind: 'os', result: JSON.parse(host.answer(server, request.op, JSON.stringify(request.args), request.orbital)) } };
    });
    progress = JSON.parse(server.resume(progress.flight, JSON.stringify(replies)));
  }
  assert.equal(progress.status, 'done');
  return progress.response;
}

const emitted = (response, event) => response.emittedEvents.find((e) => e.event === event)?.payload;

test('an os ask inside the program\'s grants is answered by the add-on', async () => {
  const server = new Server(schema([['os/exists', join(granted, 'a.txt'), routes('DONE')]]));
  const response = await run(server, osHost());
  assert.notEqual(emitted(response, 'DONE'), undefined);
  assert.equal(emitted(response, 'BAD'), undefined);
});

test('control: an os ask outside the grants is denied by the same answerer', async () => {
  const server = new Server(schema([['os/exists', join(refused, 'b.txt'), routes('DONE')]]));
  const response = await run(server, osHost());
  assert.equal(emitted(response, 'BAD').kind, 'denied');
  assert.equal(emitted(response, 'DONE'), undefined);
});

test('a keyed completion-deferring ask completes through the callback, never in place', async () => {
  const completions = [];
  const host = osHost(completions);
  const server = new Server(schema([]));
  const answered = JSON.parse(host.answerKeyed(server, 'os/exists', JSON.stringify([join(granted, 'a.txt')]), 'k1', JSON.stringify(site)));
  assert.deepEqual(answered, { deferred: true });
  for (let waited = 0; completions.length === 0 && waited < 200; waited += 1) await new Promise((wake) => setTimeout(wake, 10));
  assert.equal(completions.length, 1);
  assert.deepEqual([completions[0].key, completions[0].kind], ['k1', 'complete']);
  assert.ok('ok' in completions[0].outcome);
});

test('control: a keyed ask outside the grants completes its key as denied, as the native host does', async () => {
  const completions = [];
  const host = osHost(completions);
  const server = new Server(schema([]));
  const answered = JSON.parse(host.answerKeyed(server, 'os/exists', JSON.stringify([join(refused, 'b.txt')]), 'k2', JSON.stringify(site)));
  assert.deepEqual(answered, { deferred: true });
  for (let waited = 0; completions.length === 0 && waited < 200; waited += 1) await new Promise((wake) => setTimeout(wake, 10));
  assert.equal(completions.length, 1);
  assert.deepEqual([completions[0].key, completions[0].kind, completions[0].outcome.error.kind], ['k2', 'complete', 'denied']);
});

test('a name that is no os operation throws', () => {
  assert.throws(() => osHost().answer(new Server(schema([])), 'os/nonesuch', '[]'), /not an os operation/);
});

test('a stream that ends on a success completes its key: stdin at end of file reports one eof completion', () => {
  const child = `
    const { Server, OsHost } = require(process.env.ALMADAR_KERNEL_NODE);
    const schema = JSON.stringify({ name: 'App', typeContractVersion: 1, osGrants: { stdio: ['in'] }, orbitals: [{ name: 'Main', entity: { name: 'Job', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] }, traits: [{ name: 'Host', linkedEntity: 'Job', stateMachine: { states: [{ name: 'idle', isInitial: true }], transitions: [{ from: 'idle', to: 'idle', event: 'GO' }] } }] }] });
    const site = { trait: 'Host', followOn: false, emit: { success: 'DONE', failure: 'BAD', onMessage: 'MSG' } };
    const seen = [];
    const host = new OsHost('{}', (key, kind, json) => { seen.push([key, kind, JSON.parse(json)]); });
    const answered = JSON.parse(host.answerKeyed(new Server(schema), 'os/stdin-read', '[]', 's1', JSON.stringify(site)));
    setTimeout(() => { console.log(JSON.stringify({ answered, seen })); host.close(); process.exit(0); }, 500);
  `;
  const run = spawnSync(process.execPath, ['-e', child], { stdio: ['ignore', 'pipe', 'inherit'], env: process.env, encoding: 'utf8' });
  assert.equal(run.status, 0);
  const { answered, seen } = JSON.parse(run.stdout);
  assert.deepEqual(answered, { deferred: true });
  assert.deepEqual(seen, [['s1', 'complete', { ok: { eof: true } }]]);
});
