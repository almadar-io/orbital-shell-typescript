import { performance } from 'node:perf_hooks';
import type { OrbitalSchema, PersistenceAdapter } from '@almadar/core';
import type { KernelModule } from '@almadar/shell-web';
import { percentile } from './bench.js';
import { captureFallbackNotices, formatNotices, LatencyPersistence, PlainPersistence, type FallbackNotices } from './persistence-wrappers.js';

declare global {
  var __ALMADAR_DEBUG__: string | undefined;
}

export type ConcurrencyEngine = 'kernel';

/** Row id: the kernel host is B1-kernel-conc (design 6.1; the JS-engine B1-conc row merged in once the runtime became kernel-only). */
export const CONCURRENCY_ROW_IDS: Record<ConcurrencyEngine, string> = { kernel: 'B1-kernel-conc' };
export const DEFAULT_CLIENT_COUNTS = [1, 8, 64, 256] as const;
export const SATURATION_P99_BUDGET_MS = 50;

const ORBITAL = 'Main';
const TRAIT = 'Counters';
const EMIT = { emit: { success: 'DONE', failure: 'FAILED' } };

export function clientId(i: number): string {
  return `c${i}`;
}

/** `conc-counter`: client i increments the persisted row `c<i>`; the final count must equal the events sent. */
export function concCounterSchema(): OrbitalSchema {
  return {
    name: 'conc-counter',
    version: '1.0.0',
    orbitals: [{
      name: ORBITAL,
      pages: [],
      entity: { name: 'Counter', persistence: 'persistent', collection: 'counters', fields: [{ name: 'id', type: 'string', primaryKey: true }, { name: 'count', type: 'number' }] },
      traits: [{
        name: TRAIT,
        linkedEntity: 'Counter',
        stateMachine: {
          states: [{ name: 'idle', isInitial: true }],
          events: ['INC', 'DONE', 'FAILED'].map((e) => ({ key: e, name: e })),
          transitions: [
            { from: 'idle', to: 'idle', event: 'INC', effects: [['persist', 'update', 'Counter', { id: '@payload.id', count: ['+', ['object/get', '@entity', 'count'], 1] }, EMIT]] },
            { from: 'idle', to: 'idle', event: 'DONE' },
            { from: 'idle', to: 'idle', event: 'FAILED' },
          ],
        },
      }],
    }],
  };
}

export { LatencyPersistence };

export interface ConcurrencyRunOptions {
  engine: ConcurrencyEngine;
  kernel?: KernelModule;
  clients: number;
  eventsPerClient: number;
  /** Persistence latency per adapter call; 0 keeps flights from suspending (CPU-bound). */
  latencyMs: number;
  /**
   * Open loop: each client fires on a fixed schedule (one event every `arrivalIntervalMs`, clients staggered across
   * the interval) and latency counts from the scheduled instant, so a slow server shows queueing instead of hiding
   * it (no coordinated omission). 0 is closed loop: a client sends its next event when the last one answered.
   */
  arrivalIntervalMs: number;
  /** false hands the runtime an adapter without the optional query / write members (the fallback path). Default true. */
  pushdown?: boolean;
}

export interface ConcurrencyRowResult {
  row: string;
  clients: number;
  events: number;
  wallMs: number;
  throughputPerSec: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errors: number;
  /** Clients whose final persisted count differs from the events they sent (lost update or cross-talk). */
  invariantViolations: number;
  /** Most dispatches awaiting an answer at one instant, counted by the driver. */
  peakInFlight: number;
  /** Push-down fallback notices logged during the run, by `kind:reason`; empty means the pushed path ran. */
  fallbackNotices: FallbackNotices;
}

async function openRuntime(kernel: KernelModule, store: PersistenceAdapter) {
  globalThis.__ALMADAR_DEBUG__ = '';
  const { OrbitalServerRuntime } = await import('@almadar/shell-node/OrbitalServerRuntime');
  return new OrbitalServerRuntime({ debug: false, mode: 'real', persistence: store, kernel });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function runConcurrencyRow(options: ConcurrencyRunOptions): Promise<ConcurrencyRowResult> {
  const { value, notices } = await captureFallbackNotices(() => runRow(options));
  return { ...value, fallbackNotices: notices };
}

async function runRow(options: ConcurrencyRunOptions): Promise<Omit<ConcurrencyRowResult, 'fallbackNotices'>> {
  if (options.clients < 1 || options.eventsPerClient < 1) throw new Error('clients and eventsPerClient must be positive');
  globalThis.__ALMADAR_DEBUG__ = '';
  // No kernel given: the installed one, which also holds the counters.
  const { loadInstalledKernel, nativeMemoryOf } = await import('@almadar/shell-node');
  const kernel = options.kernel ?? await loadInstalledKernel(process.cwd());
  const memory = nativeMemoryOf(kernel);
  for (let i = 0; i < options.clients; i++) await memory.create('Counter', { id: clientId(i), count: 0 });
  const store = new LatencyPersistence(options.pushdown === false ? new PlainPersistence(memory) : memory, options.latencyMs);
  const runtime = await openRuntime(kernel, store);
  await runtime.register(concCounterSchema());

  const latencies: number[] = [];
  let errors = 0;
  let inFlight = 0;
  let peak = 0;
  const fire = async (i: number, scheduledAt: number): Promise<void> => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      const response = await runtime.processOrbitalEvent(ORBITAL, { event: 'INC', targetTrait: TRAIT, entityId: clientId(i), payload: { id: clientId(i) } });
      if (response.success !== true || response.error !== undefined) errors++;
    } catch {
      errors++;
    } finally {
      inFlight--;
      latencies.push(performance.now() - scheduledAt);
    }
  };

  const started = performance.now();
  const clients = Array.from({ length: options.clients }, async (_, i) => {
    const inflight: Promise<void>[] = [];
    for (let k = 0; k < options.eventsPerClient; k++) {
      if (options.arrivalIntervalMs > 0) {
        const scheduledAt = started + k * options.arrivalIntervalMs + (i / options.clients) * options.arrivalIntervalMs;
        const wait = scheduledAt - performance.now();
        if (wait > 0) await sleep(wait);
        inflight.push(fire(i, scheduledAt));
      } else {
        await fire(i, performance.now());
      }
    }
    await Promise.all(inflight);
  });
  await Promise.all(clients);
  const wallMs = performance.now() - started;

  let invariantViolations = 0;
  for (let i = 0; i < options.clients; i++) {
    const row = await memory.getById('Counter', clientId(i));
    if (row === null || row.count !== options.eventsPerClient) invariantViolations++;
  }
  runtime.unregisterAll();

  const sorted = [...latencies].sort((a, b) => a - b);
  const events = options.clients * options.eventsPerClient;
  return {
    row: CONCURRENCY_ROW_IDS[options.engine],
    clients: options.clients,
    events,
    wallMs,
    throughputPerSec: wallMs > 0 ? (events / wallMs) * 1000 : 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    errors,
    invariantViolations,
    peakInFlight: peak,
  };
}

export interface ConcurrencySweep {
  row: string;
  results: ConcurrencyRowResult[];
  /** Throughput at the highest client count whose p99 stays within the budget; null when even the smallest N exceeds it. */
  saturation: { clients: number; throughputPerSec: number } | null;
}

export function saturationPoint(results: readonly ConcurrencyRowResult[], p99BudgetMs: number): ConcurrencySweep['saturation'] {
  let best: ConcurrencySweep['saturation'] = null;
  for (const r of results) {
    if (r.p99Ms <= p99BudgetMs && r.errors === 0 && (best === null || r.clients > best.clients)) best = { clients: r.clients, throughputPerSec: r.throughputPerSec };
  }
  return best;
}

export async function runConcurrencySweep(
  base: Omit<ConcurrencyRunOptions, 'clients'>,
  clientCounts: readonly number[] = DEFAULT_CLIENT_COUNTS,
  p99BudgetMs: number = SATURATION_P99_BUDGET_MS,
): Promise<ConcurrencySweep> {
  const results: ConcurrencyRowResult[] = [];
  for (const clients of clientCounts) results.push(await runConcurrencyRow({ ...base, clients }));
  return { row: CONCURRENCY_ROW_IDS[base.engine], results, saturation: saturationPoint(results, p99BudgetMs) };
}

export function formatConcurrencySweep(sweep: ConcurrencySweep): string {
  const lines = [`${sweep.row}`, 'clients  events  ev/s      p50ms   p95ms   p99ms   errors  violations  peakInFlight'];
  for (const r of sweep.results) {
    lines.push(
      `${String(r.clients).padEnd(8)} ${String(r.events).padEnd(7)} ${r.throughputPerSec.toFixed(0).padEnd(9)} ${r.p50Ms.toFixed(2).padEnd(7)} ${r.p95Ms.toFixed(2).padEnd(7)} ${r.p99Ms.toFixed(2).padEnd(7)} ${String(r.errors).padEnd(7)} ${String(r.invariantViolations).padEnd(11)} ${r.peakInFlight}`,
    );
  }
  const paths = [...new Set(sweep.results.map((r) => formatNotices(r.fallbackNotices)))];
  lines.push(`path: ${sweep.row.includes('kernel') ? 'the kernel host logs no fallback notices (use write-heavy counts to confirm push-down)' : paths.join(' | ')}`);
  lines.push(sweep.saturation === null ? `saturation: none (p99 over ${SATURATION_P99_BUDGET_MS} ms at every N)` : `saturation: ${sweep.saturation.throughputPerSec.toFixed(0)} ev/s at N=${sweep.saturation.clients} (highest N with p99 <= ${SATURATION_P99_BUDGET_MS} ms)`);
  return lines.join('\n');
}
