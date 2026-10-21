import type { MemorySample, Scenario, ScenarioSession } from './types.js';

export const SOAK_DEFAULT_EVENTS = 100_000;
export const SOAK_MAX_EVENTS = 1_000_000;
export const SOAK_SAMPLE_EVERY = 5_000;
export const SOAK_WARMUP_FRACTION = 0.2;
export const SOAK_LEAK_BYTES_PER_EVENT = 8;

/** Kernel counters named in design section 6.3; absent until the Rust `stats()` returns them. */
export interface KernelStatsSample {
  frames: number;
  stateInstances: number;
  renderSlots: number;
  dispatchMemoryEntries: number;
  inFlight: number;
  journalLen: number;
  rowSets: number;
}

export interface SoakProbe {
  /** Store row count across entities; null when the runtime cannot report it. */
  rowCount(): Promise<number | null>;
  /** Null until the kernel exposes KernelStats. */
  kernelStats(): Promise<KernelStatsSample | null>;
}

export const NO_PROBE: SoakProbe = { rowCount: async () => null, kernelStats: async () => null };

export interface SoakSample {
  events: number;
  heapUsedBytes: number;
  rssBytes: number | null;
  rowCount: number | null;
  kernelStats: KernelStatsSample | null;
}

export interface SoakOptions {
  events?: number;
  sampleEvery?: number;
  probe?: SoakProbe;
  readMemory(): Promise<MemorySample>;
  /** Called after each sample so a long run can stream its series. */
  onSample?(sample: SoakSample): void;
}

export async function runSoak(session: ScenarioSession, scenario: Scenario, options: SoakOptions): Promise<SoakSample[]> {
  const events = options.events ?? SOAK_DEFAULT_EVENTS;
  const every = options.sampleEvery ?? SOAK_SAMPLE_EVERY;
  if (!Number.isInteger(events) || events < 1 || events > SOAK_MAX_EVENTS) throw new Error(`soak events must be an integer in [1, ${SOAK_MAX_EVENTS}]`);
  if (!Number.isInteger(every) || every < 1) throw new Error('soak sampleEvery must be a positive integer');
  if (scenario.steps.length === 0) throw new Error('soak scenario has no steps');
  const probe = options.probe ?? NO_PROBE;
  const samples: SoakSample[] = [];
  const take = async (n: number): Promise<void> => {
    const memory = await options.readMemory();
    const sample: SoakSample = {
      events: n,
      heapUsedBytes: memory.heapUsedBytes,
      rssBytes: memory.rssBytes,
      rowCount: await probe.rowCount(),
      kernelStats: await probe.kernelStats(),
    };
    samples.push(sample);
    options.onSample?.(sample);
  };
  await take(0);
  for (let i = 1; i <= events; i++) {
    await session.dispatch(scenario.steps[(i - 1) % scenario.steps.length]);
    if (i % every === 0 || i === events) await take(i);
  }
  return samples;
}

const STATS_KEYS = ['frames', 'stateInstances', 'renderSlots', 'dispatchMemoryEntries', 'inFlight', 'journalLen', 'rowSets'] as const;

export function soakCsv(samples: readonly SoakSample[]): string {
  const header = ['events', 'heapUsedBytes', 'rssBytes', 'rowCount', ...STATS_KEYS].join(',');
  const cell = (v: number | null | undefined): string => (v === null || v === undefined ? '' : String(v));
  const lines = samples.map((s) =>
    [s.events, s.heapUsedBytes, cell(s.rssBytes), cell(s.rowCount), ...STATS_KEYS.map((k) => cell(s.kernelStats?.[k]))].join(','),
  );
  return [header, ...lines].join('\n') + '\n';
}

/** Least-squares slope of y over x; null with fewer than two distinct x. */
export function leastSquaresSlope(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

export type LeakVerdict = 'flat' | 'leak' | 'data-growth' | 'insufficient-samples';

export interface LeakReport {
  verdict: LeakVerdict;
  heapSlopeBytesPerEvent: number | null;
  rowCountConstant: boolean | null;
  windowSamples: number;
}

/** Heap slope after warm-up. A leak is only called when store rows are known and constant; growing rows are data. */
export function assessLeak(samples: readonly SoakSample[], threshold = SOAK_LEAK_BYTES_PER_EVENT, warmupFraction = SOAK_WARMUP_FRACTION): LeakReport {
  const last = samples.length === 0 ? 0 : samples[samples.length - 1].events;
  const window = samples.filter((s) => s.events >= last * warmupFraction);
  const slope = leastSquaresSlope(window.map((s) => s.events), window.map((s) => s.heapUsedBytes));
  if (slope === null || window.length < 3) {
    return { verdict: 'insufficient-samples', heapSlopeBytesPerEvent: slope, rowCountConstant: null, windowSamples: window.length };
  }
  const rows = window.map((s) => s.rowCount);
  const known = rows.every((r): r is number => r !== null);
  const constant = known ? new Set(rows).size === 1 : null;
  if (slope <= threshold) return { verdict: 'flat', heapSlopeBytesPerEvent: slope, rowCountConstant: constant, windowSamples: window.length };
  return { verdict: constant === true ? 'leak' : 'data-growth', heapSlopeBytesPerEvent: slope, rowCountConstant: constant, windowSamples: window.length };
}
