import { performance } from 'node:perf_hooks';
import type { OrbitalSchema } from '@almadar/core';
import type { KernelModule } from '@almadar/shell-web';
import { percentile } from './bench.js';
import { captureFallbackNotices, CountingPersistence, formatNotices, PERSISTENCE_METHODS, PlainPersistence, type FallbackNotices, type PersistenceMethod } from './persistence-wrappers.js';

declare global {
  var __ALMADAR_DEBUG__: string | undefined;
}

export type WriteHeavyEngine = 'kernel';
export type WriteOp = 'update' | 'create' | 'batch';

/** Design 6.4: the write mix row on the JS engine and on the kernel host. */
export const WRITE_HEAVY_ROW_IDS: Record<WriteHeavyEngine, string> = { kernel: 'B1-kernel-write-heavy' };
export const WRITE_HEAVY_TABLE_ROWS = 10_000;
export const WRITE_HEAVY_OPS = 10_000;
export const WRITE_MIX: Record<WriteOp, number> = { update: 0.8, create: 0.1, batch: 0.1 };
export const WRITE_BATCH_SIZE = 3;
export const WRITE_HEAVY_SEED = 20261014;

const ORBITAL = 'Main';
const TRAIT = 'Items';
const EMIT = { emit: { success: 'DONE', failure: 'FAILED' } };

export function itemId(n: number): string {
  return `item-${String(n).padStart(6, '0')}`;
}

export function writeHeavySchema(): OrbitalSchema {
  const batchOp = (key: string): [string, string, { id: string; n: number }] => ['create', 'Item', { id: `@payload.${key}`, n: 0 }];
  return {
    name: 'write-heavy',
    version: '1.0.0',
    orbitals: [{
      name: ORBITAL,
      pages: [],
      entity: { name: 'Item', persistence: 'persistent', collection: 'items', fields: [{ name: 'id', type: 'string', primaryKey: true }, { name: 'n', type: 'number' }] },
      traits: [{
        name: TRAIT,
        scope: 'instance',
        linkedEntity: 'Item',
        stateMachine: {
          states: [{ name: 'idle', isInitial: true }],
          events: ['UPDATE', 'CREATE', 'BATCH', 'DONE', 'FAILED'].map((e) => ({ key: e, name: e })),
          transitions: [
            { from: 'idle', to: 'idle', event: 'UPDATE', effects: [['persist', 'update', 'Item', { id: '@payload.id', n: '@payload.n' }, EMIT]] },
            { from: 'idle', to: 'idle', event: 'CREATE', effects: [['persist', 'create', 'Item', { id: '@payload.id', n: '@payload.n' }, EMIT]] },
            { from: 'idle', to: 'idle', event: 'BATCH', effects: [['persist', 'batch', [batchOp('a'), batchOp('b'), batchOp('c')], EMIT]] },
            { from: 'idle', to: 'idle', event: 'DONE' },
            { from: 'idle', to: 'idle', event: 'FAILED' },
          ],
        },
      }],
    }],
  };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PlannedOp {
  op: WriteOp;
  payload: { [key: string]: string | number };
}

/** The deterministic op sequence: kinds drawn from `mix`, updates hit random seeded rows, creates and batches use fresh ids. */
export function planWriteMix(ops: number, tableRows: number, seed: number = WRITE_HEAVY_SEED, mix: Record<WriteOp, number> = WRITE_MIX): PlannedOp[] {
  const random = seededRandom(seed);
  const plan: PlannedOp[] = [];
  let fresh = tableRows;
  for (let i = 0; i < ops; i++) {
    const roll = random();
    if (roll < mix.update) {
      plan.push({ op: 'update', payload: { id: itemId(1 + Math.floor(random() * tableRows)), n: i } });
    } else if (roll < mix.update + mix.create) {
      plan.push({ op: 'create', payload: { id: itemId(++fresh), n: i } });
    } else {
      plan.push({ op: 'batch', payload: { a: itemId(++fresh), b: itemId(++fresh), c: itemId(++fresh) } });
    }
  }
  return plan;
}

const EVENT: Record<WriteOp, string> = { update: 'UPDATE', create: 'CREATE', batch: 'BATCH' };

export interface WriteOpStats {
  ops: number;
  p50Ms: number;
  p99Ms: number;
  /** Adapter calls per op, by method (only methods that were called). */
  callsPerOp: Partial<Record<PersistenceMethod, number>>;
  totalCallsPerOp: number;
}

export interface WriteHeavyOptions {
  engine: WriteHeavyEngine;
  kernel?: KernelModule;
  tableRows: number;
  ops: number;
  seed?: number;
  /** false hands the runtime an adapter without the optional query / write members (the fallback path). Default true. */
  pushdown?: boolean;
}

export interface WriteHeavyResult {
  row: string;
  tableRows: number;
  ops: number;
  wallMs: number;
  opsPerSec: number;
  errors: number;
  byOp: Record<WriteOp, WriteOpStats | null>;
  /** Row count and a spot check after the run: expected = tableRows + creates + batch ops. */
  finalRows: number;
  expectedRows: number;
  /** Push-down fallback notices logged during the run, by `kind:reason`; empty means the pushed path ran. */
  fallbackNotices: FallbackNotices;
}

export async function runWriteHeavyRow(options: WriteHeavyOptions): Promise<WriteHeavyResult> {
  const { value, notices } = await captureFallbackNotices(() => runRow(options));
  return { ...value, fallbackNotices: notices };
}

async function runRow(options: WriteHeavyOptions): Promise<Omit<WriteHeavyResult, 'fallbackNotices'>> {
  if (options.ops < 1 || options.tableRows < 1) throw new Error('ops and tableRows must be positive');
  globalThis.__ALMADAR_DEBUG__ = '';
  const { OrbitalServerRuntime } = await import('@almadar/shell-node/OrbitalServerRuntime');
  const { loadInstalledKernel, nativeMemoryOf } = await import('@almadar/shell-node');
  const kernel = options.kernel ?? await loadInstalledKernel(process.cwd());
  const memory = nativeMemoryOf(kernel);
  for (let n = 1; n <= options.tableRows; n++) await memory.create('Item', { id: itemId(n), n: 0 });
  const counting = new CountingPersistence(options.pushdown === false ? new PlainPersistence(memory) : memory);
  // No kernel given: the installed one, which also holds the table.
  const runtime = new OrbitalServerRuntime({ debug: false, mode: 'real', persistence: counting, kernel });
  await runtime.register(writeHeavySchema());

  const plan = planWriteMix(options.ops, options.tableRows, options.seed);
  const times: Record<WriteOp, number[]> = { update: [], create: [], batch: [] };
  const calls: Record<WriteOp, Record<PersistenceMethod, number>> = {
    update: Object.fromEntries(PERSISTENCE_METHODS.map((m) => [m, 0])) as Record<PersistenceMethod, number>,
    create: Object.fromEntries(PERSISTENCE_METHODS.map((m) => [m, 0])) as Record<PersistenceMethod, number>,
    batch: Object.fromEntries(PERSISTENCE_METHODS.map((m) => [m, 0])) as Record<PersistenceMethod, number>,
  };
  let errors = 0;
  let expectedRows = options.tableRows;
  const started = performance.now();
  for (const planned of plan) {
    counting.reset();
    const t0 = performance.now();
    const response = await runtime.processOrbitalEvent(ORBITAL, { event: EVENT[planned.op], targetTrait: TRAIT, payload: planned.payload });
    times[planned.op].push(performance.now() - t0);
    if (response.success !== true || response.error !== undefined) errors++;
    else if (planned.op === 'create') expectedRows += 1;
    else if (planned.op === 'batch') expectedRows += WRITE_BATCH_SIZE;
    const byMethod = counting.counts().byMethod;
    for (const m of PERSISTENCE_METHODS) calls[planned.op][m] += byMethod[m];
  }
  const wallMs = performance.now() - started;
  const finalRows = (await memory.list('Item')).length;
  runtime.unregisterAll();

  const stats = (op: WriteOp): WriteOpStats | null => {
    const sorted = [...times[op]].sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const callsPerOp: Partial<Record<PersistenceMethod, number>> = {};
    let total = 0;
    for (const m of PERSISTENCE_METHODS) {
      if (calls[op][m] > 0) callsPerOp[m] = calls[op][m] / sorted.length;
      total += calls[op][m];
    }
    return { ops: sorted.length, p50Ms: percentile(sorted, 50), p99Ms: percentile(sorted, 99), callsPerOp, totalCallsPerOp: total / sorted.length };
  };
  return {
    row: WRITE_HEAVY_ROW_IDS[options.engine],
    tableRows: options.tableRows,
    ops: options.ops,
    wallMs,
    opsPerSec: wallMs > 0 ? (options.ops / wallMs) * 1000 : 0,
    errors,
    byOp: { update: stats('update'), create: stats('create'), batch: stats('batch') },
    finalRows,
    expectedRows,
  };
}

export function formatWriteHeavy(result: WriteHeavyResult): string {
  const lines = [
    `${result.row}: ${result.ops} ops over ${result.tableRows} rows, ${result.opsPerSec.toFixed(0)} ops/s, errors ${result.errors}, rows ${result.finalRows}/${result.expectedRows}`,
    `path: ${result.row.includes('kernel') ? 'the kernel host logs no fallback notices; read the writeWhere/writeBatch counts below' : formatNotices(result.fallbackNotices)}`,
    'op      ops     p50ms   p99ms   calls/op  by method',
  ];
  for (const op of ['update', 'create', 'batch'] as const) {
    const s = result.byOp[op];
    if (s === null) continue;
    const detail = Object.entries(s.callsPerOp).map(([m, n]) => `${m}=${n.toFixed(2)}`).join(' ');
    lines.push(`${op.padEnd(7)} ${String(s.ops).padEnd(7)} ${s.p50Ms.toFixed(3).padEnd(7)} ${s.p99Ms.toFixed(3).padEnd(7)} ${s.totalCallsPerOp.toFixed(2).padEnd(9)} ${detail}`);
  }
  return lines.join('\n');
}
