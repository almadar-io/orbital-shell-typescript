// The plain Node server leaves the row ask to the host.
// Run: ORBITAL_KERNEL_NODE=<path to kernel.node> node --test crates/orbital-shell-typescript/bridges/node/tests/stored.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'stored');
const { Server } = createRequire(import.meta.url)(process.env.ORBITAL_KERNEL_NODE);
const schema = readFileSync(join(fixtures, 'notes.schema.json'), 'utf8');
const save = JSON.stringify({ event: 'SAVE', targetTrait: 'Draft' });

test('the plain server leaves the row ask to the host', () => {
  const waiting = JSON.parse(new Server(schema).start('Main', save));
  assert.equal(waiting.status, 'await');
  assert.deepEqual(waiting.requests.map((r) => r.request.kind), ['readRow']);
});
