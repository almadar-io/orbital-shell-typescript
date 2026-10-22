import { cpus, loadavg } from 'node:os';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { scenarioKey } from './fixtures.js';
import { applyClockFields, applyMintedIds, compareTraces, type TraceDifference } from './trace.js';
import type { CommitRecord } from './commits.js';
import type { HarnessMeasurements, MemorySample, Scenario, ScenarioFixture, ScenarioHarness, ScenarioSession, Trace } from './types.js';

export const WARMUP_RUNS = 5;
export const MEASURED_RUNS = 50;
export const MEMORY_EVENTS = 10000;

export interface LatencyStats {
  p50Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  samples: number;
  medianOfRunMediansMs: number;
  runMedianSpreadMs: { min: number; max: number };
}

export interface WorkloadTiming {
  eventLatency: LatencyStats;
  stepsPerSecond: number;
  mountMedianMs: number;
  coldStart: { moduleLoadMs: number; initMs: number; firstDispatchMs: number; totalMs: number };
  memory: { afterMount: MemorySample; afterEvents: MemorySample | null; events: number };
}

export interface WorkloadResult {
  key: string;
  fixture: string;
  scenario: string;
  status: 'timed' | 'parityFailure' | 'error';
  trace: Trace | null;
  parityFailure?: TraceDifference;
  error?: string;
  timing?: WorkloadTiming;
}

export interface BenchEnvironment {
  node: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  loadAverage: number[];
  note: string;
}

export interface BenchResult {
  harness: string;
  harnessName: string;
  reference: string;
  commits: Record<string, CommitRecord>;
  environment: BenchEnvironment;
  warmupRuns: number;
  measuredRuns: number;
  workloads: WorkloadResult[];
  measurements?: HarnessMeasurements;
}

export type ReferenceTraces = Map<string, Trace>;

export interface BenchOptions {
  harness: ScenarioHarness;
  fixtures: ScenarioFixture[];
  references: ReferenceTraces;
  referenceLabel: string;
  commits: Record<string, CommitRecord>;
  environmentNote?: string;
  warmupRuns?: number;
  measuredRuns?: number;
  memoryEvents?: number;
  coldStartFixtures?: readonly string[];
  coldStartRuns?: number;
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile of no samples');
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function median(values: readonly number[]): number {
  return percentile([...values].sort((a, b) => a - b), 50);
}

function latencyStats(perRun: readonly (readonly number[])[]): LatencyStats {
  const pooled = perRun.flat().sort((a, b) => a - b);
  const runMedians = perRun.map((r) => median(r));
  return {
    p50Ms: percentile(pooled, 50),
    p99Ms: percentile(pooled, 99),
    minMs: pooled[0],
    maxMs: pooled[pooled.length - 1],
    samples: pooled.length,
    medianOfRunMediansMs: median(runMedians),
    runMedianSpreadMs: { min: Math.min(...runMedians), max: Math.max(...runMedians) },
  };
}

export const COLD_START_RUNS = 10;

function sampleProcessMemory(): MemorySample {
  const usage = process.memoryUsage();
  return { heapUsedBytes: usage.heapUsed, rssBytes: usage.rss };
}

interface RunOutcome {
  trace: Trace;
  mountMs: number;
  latenciesMs: number[];
}

async function timedDispatch(session: ScenarioSession, step: Scenario['steps'][number]): Promise<{ traced: Trace['steps'][number]; ms: number }> {
  const start = performance.now();
  const traced = await session.dispatch(step);
  const outside = performance.now() - start;
  return { traced, ms: session.lastDispatchMs ?? outside };
}

async function sampleMemory(session: ScenarioSession): Promise<MemorySample> {
  return session.sampleMemory === undefined ? sampleProcessMemory() : session.sampleMemory();
}

async function runOnce(harness: ScenarioHarness, fixture: ScenarioFixture, scenario: Scenario): Promise<RunOutcome> {
  const openStart = performance.now();
  const session = await harness.open(fixture, scenario);
  const mountMs = session.openMs ?? performance.now() - openStart;
  const latenciesMs: number[] = [];
  const steps: Trace['steps'] = [];
  try {
    for (const step of scenario.steps) {
      const { traced, ms } = await timedDispatch(session, step);
      latenciesMs.push(ms);
      steps.push(traced);
    }
  } finally {
    await session.close();
  }
  return { trace: { steps }, mountMs, latenciesMs };
}

async function measureMemory(harness: ScenarioHarness, fixture: ScenarioFixture, scenario: Scenario, events: number): Promise<WorkloadTiming['memory']> {
  const session = await harness.open(fixture, scenario);
  try {
    const afterMount = await sampleMemory(session);
    let afterEvents: MemorySample | null = null;
    try {
      for (let i = 0; i < events; i++) await session.dispatch(scenario.steps[i % scenario.steps.length]);
      afterEvents = await sampleMemory(session);
    } catch {
      afterEvents = null;
    }
    return { afterMount, afterEvents, events };
  } finally {
    await session.close();
  }
}

async function benchWorkload(options: BenchOptions, fixture: ScenarioFixture, scenario: Scenario, index: number, wholeSetupMs: number): Promise<WorkloadResult> {
  const { harness } = options;
  const key = scenarioKey(fixture, index);
  const base = { key, fixture: fixture.name, scenario: scenario.name ?? `${scenario.steps[0].trait}.${scenario.steps[0].event}` };
  const ungated = options.harness.ungated === true;
  const reference = ungated ? null : options.references.get(key);
  if (reference === undefined) {
    return { ...base, status: 'error', trace: null, error: `no reference trace for ${key} from ${options.referenceLabel}` };
  }
  const gate = (trace: Trace): TraceDifference | null =>
    reference === null ? null : compareTraces(applyMintedIds(applyClockFields(reference, fixture.clockFields), fixture.mintedIdFields), applyMintedIds(applyClockFields(trace, fixture.clockFields), fixture.mintedIdFields));

  try {
    const coldStart = performance.now();
    const session = await harness.open(fixture, scenario);
    const initMs = session.openMs ?? performance.now() - coldStart;
    const steps: Trace['steps'] = [];
    let firstDispatchMs = 0;
    try {
      for (const [i, step] of scenario.steps.entries()) {
        const { traced, ms } = await timedDispatch(session, step);
        if (i === 0) firstDispatchMs = ms;
        steps.push(traced);
      }
    } finally {
      await session.close();
    }
    const firstTrace: Trace = { steps };
    const firstDifference = gate(firstTrace);
    if (firstDifference !== null) return { ...base, status: 'parityFailure', trace: firstTrace, parityFailure: firstDifference };

    const warmups = options.warmupRuns ?? WARMUP_RUNS;
    const measured = options.measuredRuns ?? MEASURED_RUNS;
    for (let i = 0; i < warmups; i++) {
      const outcome = await runOnce(harness, fixture, scenario);
      const difference = gate(outcome.trace);
      if (difference !== null) return { ...base, status: 'parityFailure', trace: outcome.trace, parityFailure: difference };
    }
    const perRunLatencies: number[][] = [];
    const mounts: number[] = [];
    let dispatchedMs = 0;
    for (let i = 0; i < measured; i++) {
      const outcome = await runOnce(harness, fixture, scenario);
      const difference = gate(outcome.trace);
      if (difference !== null) return { ...base, status: 'parityFailure', trace: outcome.trace, parityFailure: difference };
      perRunLatencies.push(outcome.latenciesMs);
      mounts.push(outcome.mountMs);
      dispatchedMs += outcome.latenciesMs.reduce((a, b) => a + b, 0);
    }
    const moduleLoadMs = harness.moduleLoadMs ?? wholeSetupMs;
    const eventCount = perRunLatencies.reduce((n, r) => n + r.length, 0);
    const memory = await measureMemory(harness, fixture, scenario, options.memoryEvents ?? MEMORY_EVENTS);
    return {
      ...base,
      status: 'timed',
      trace: firstTrace,
      timing: {
        eventLatency: latencyStats(perRunLatencies),
        stepsPerSecond: eventCount / (dispatchedMs / 1000),
        mountMedianMs: median(mounts),
        coldStart: { moduleLoadMs, initMs, firstDispatchMs, totalMs: moduleLoadMs + initMs + firstDispatchMs },
        memory,
      },
    };
  } catch (error) {
    return { ...base, status: 'error', trace: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runBench(options: BenchOptions): Promise<BenchResult> {
  try {
    return await runBenchOpen(options);
  } finally {
    await options.harness.dispose?.();
  }
}

async function runBenchOpen(options: BenchOptions): Promise<BenchResult> {
  const loadStart = performance.now();
  const available = await options.harness.isAvailable();
  const moduleLoadMs = performance.now() - loadStart;
  if (!available) throw new Error(`harness ${options.harness.id} is not available`);

  const workloads: WorkloadResult[] = [];
  for (const fixture of options.fixtures) {
    for (const [index, scenario] of fixture.scenarios.entries()) {
      workloads.push(await benchWorkload(options, fixture, scenario, index, moduleLoadMs));
    }
  }
  const measurements = options.harness.measure === undefined
    ? undefined
    : await options.harness.measure(options.fixtures, options.coldStartFixtures ?? [], options.coldStartRuns ?? COLD_START_RUNS);
  const cpu = cpus();
  return {
    ...(measurements === undefined ? {} : { measurements }),
    harness: options.harness.id,
    harnessName: options.harness.name,
    reference: options.referenceLabel,
    commits: options.commits,
    environment: {
      node: options.harness.runtimeLabel ?? process.version,
      platform: process.platform,
      arch: process.arch,
      cpuModel: cpu.length > 0 ? cpu[0].model : 'unknown',
      cpuCount: cpu.length,
      loadAverage: loadavg(),
      note: options.environmentNote ?? '',
    },
    warmupRuns: options.warmupRuns ?? WARMUP_RUNS,
    measuredRuns: options.measuredRuns ?? MEASURED_RUNS,
    workloads,
  };
}

/** Runs the reference harness once per workload to obtain the traces every other row must equal. */
export async function referenceFromHarness(harness: ScenarioHarness, fixtures: ScenarioFixture[]): Promise<ReferenceTraces> {
  try {
    if (!(await harness.isAvailable())) throw new Error(`reference harness ${harness.id} is not available`);
    const traces: ReferenceTraces = new Map();
    for (const fixture of fixtures) {
      for (const [index, scenario] of fixture.scenarios.entries()) {
        traces.set(scenarioKey(fixture, index), (await runOnce(harness, fixture, scenario)).trace);
      }
    }
    return traces;
  } finally {
    await harness.dispose?.();
  }
}

/** A bench result file doubles as a reference: its recorded workload traces. */
export async function referenceFromResultFile(path: string): Promise<ReferenceTraces> {
  const result: BenchResult = JSON.parse(await readFile(path, 'utf8'));
  const traces: ReferenceTraces = new Map();
  for (const workload of result.workloads) {
    if (workload.trace !== null) traces.set(workload.key, workload.trace);
  }
  return traces;
}

export interface ResultDifference {
  key: string;
  label: string;
  outcome: 'equal' | 'differs' | 'unavailable';
  difference?: TraceDifference;
  reason?: string;
}

/** Compares two result files workload by workload on their recorded traces (clock fields normalised per fixture). */
export function compareResults(left: BenchResult, right: BenchResult, fixtures: readonly ScenarioFixture[]): ResultDifference[] {
  const clockFields = new Map<string, string[]>();
  for (const fixture of fixtures) for (const index of fixture.scenarios.keys()) clockFields.set(scenarioKey(fixture, index), fixture.clockFields);
  return left.workloads.map((l): ResultDifference => {
    const base = { key: l.key, label: `${l.fixture} / ${l.scenario}` };
    const r = right.workloads.find((w) => w.key === l.key);
    const fields = clockFields.get(l.key);
    if (r === undefined || l.trace === null || r.trace === null || fields === undefined) {
      return { ...base, outcome: 'unavailable', reason: r === undefined ? `no ${l.key} in ${right.harness}` : 'a side recorded no trace' };
    }
    const difference = compareTraces(applyClockFields(l.trace, fields), applyClockFields(r.trace, fields));
    return difference === null ? { ...base, outcome: 'equal' } : { ...base, outcome: 'differs', difference };
  });
}
