import type { OrbitalSchema } from '@almadar/core';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface EmitRecord {
  event: string;
  payload: JsonValue;
}

export interface StepExpectation {
  states?: Record<string, string>;
  emits?: EmitRecord[];
}

export interface ScenarioStep {
  trait: string;
  event: string;
  payload: JsonValue | undefined;
  expect?: StepExpectation;
}

export interface Scenario {
  name?: string;
  orbital: string;
  steps: ScenarioStep[];
}

export interface ScenarioFixture {
  name: string;
  description?: string;
  schema: OrbitalSchema;
  clockFields: string[];
  /** `Event.path` fields holding an id the store minted; compared as "a minted id". */
  mintedIdFields: string[];
  dispatchModes?: Record<string, string>;
  scenarios: Scenario[];
}

export interface TraceStep {
  trait: string;
  event: string;
  states: Record<string, string>;
  effects: JsonValue[];
  emits: EmitRecord[];
}

export interface Trace {
  steps: TraceStep[];
}

export interface MemorySample {
  heapUsedBytes: number;
  rssBytes: number | null;
}

export interface BundleFile {
  file: string;
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}

export interface ColdStartSample {
  moduleLoadMs: number;
  initMs: number;
  firstDispatchMs: number;
  totalMs: number;
}

export interface ColdStartRuns {
  fixture: string;
  scenario: string;
  samples: ColdStartSample[];
}

/** What only a packaged artifact has: its shipped bytes, and cold starts taken in fresh runtimes. */
export interface HarnessMeasurements {
  bundle: BundleFile[];
  coldStart: ColdStartRuns[];
}

export interface ScenarioSession {
  dispatch(step: ScenarioStep): Promise<TraceStep>;
  close(): Promise<void>;
  /**
   * Set by harnesses that time inside their own runtime, so a transport hop (a CDP round trip) is
   * not part of the latency. When absent, the bench times `dispatch` from outside.
   */
  readonly lastDispatchMs?: number;
  /** Likewise for opening the session (kernel construction), when the harness times it itself. */
  readonly openMs?: number;
  /** Memory as the harness's own runtime sees it; when absent the bench samples this process. */
  sampleMemory?(): Promise<MemorySample>;
}

/**
 * One benchmark row. R1 (C ABI), and R2/R3 (WASM kernel)
 * are added by implementing this interface and registering a factory; the
 * bench and report code only ever see this shape.
 */
export interface ScenarioHarness {
  readonly id: string;
  readonly name: string;
  /** npm package names whose commit SHAs the numbers depend on. */
  readonly measuredPackages: readonly string[];
  /** Floor rows measure part of the work (no response building, no serialization), so no trace is compared. */
  readonly ungated?: true;
  isAvailable(): Promise<boolean>;
  /** Set by harnesses whose module load is measured inside their own runtime, not around `isAvailable`. */
  readonly moduleLoadMs?: number;
  /** The runtime the row executes in, when it is not this Node process (shown in the report's runtime column). */
  readonly runtimeLabel?: string;
  /** Releases what `isAvailable` started (a browser, a server). */
  dispose?(): Promise<void>;
  /** Bundle size and fresh-runtime cold starts, for rows that ship an artifact. */
  measure?(fixtures: ScenarioFixture[], coldStartFixtures: readonly string[], runs: number): Promise<HarnessMeasurements>;
  open(fixture: ScenarioFixture, scenario: Scenario): Promise<ScenarioSession>;
}
