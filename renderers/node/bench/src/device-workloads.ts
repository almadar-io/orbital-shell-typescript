import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadScenarioFixtures } from './fixtures.js';
import type { JsonValue } from './types.js';

export const DISPATCH_EVENTS = 10_000;
export const FRAME_COUNTS = [100, 1000] as const;
export const FRAME_STEP_MS = 1000 / 60;
export const FRAMES_PER_RUN = 600;
export const SUSTAINED_SECONDS = 300;

type JsonObject = { [key: string]: JsonValue };

export interface DispatchWorkloadSpec {
  id: 'dispatch-1e4';
  kind: 'dispatch';
  schema: JsonValue;
  orbital: string;
  steps: { trait: string; event: string; payload: JsonValue }[];
  events: number;
}

export interface FrameWorkloadSpec {
  id: string;
  kind: 'frame';
  schema: JsonValue;
  bootTraits: string[];
  ticks: number;
  frames: number;
  frameStepMs: number;
}

export type DeviceWorkloadSpec = DispatchWorkloadSpec | FrameWorkloadSpec;

function asObject(value: JsonValue | undefined, where: string): JsonObject {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where}: expected an object`);
  return value;
}

function asArray(value: JsonValue | undefined, where: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`${where}: expected an array`);
  return value;
}

/**
 * A resolved schema with `ticking` instance traits, each declaring one `frame` tick (it runs on every
 * host frame), cloned from the first trait of the base schema's first orbital. Returns the trait names.
 */
export function buildFrameSchema(base: JsonValue, ticking: number): { schema: JsonValue; traits: string[] } {
  if (!Number.isInteger(ticking) || ticking <= 0) throw new Error('ticking must be a positive integer');
  const schema = structuredClone(asObject(base, 'schema'));
  delete schema.ledger;
  const orbital = asObject(asArray(schema.orbitals, 'orbitals')[0], 'orbitals[0]');
  const template = asObject(asArray(orbital.traits, 'orbitals[0].traits')[0], 'orbitals[0].traits[0]');
  const frameTick = asArray(template.ticks, 'template.ticks').find((t) => asObject(t, 'tick').interval === 'frame');
  if (frameTick === undefined) throw new Error('the base schema has no trait with a frame tick');
  const traits: JsonObject[] = [];
  for (let i = 0; i < ticking; i += 1) {
    const clone: JsonObject = { ...structuredClone(template), id: `trt_bench_${i}`, name: `FrameTicker${i}`, ticks: [structuredClone(frameTick)] };
    delete clone.emits;
    traits.push(clone);
  }
  orbital.traits = traits;
  orbital.pages = [{ id: 'pag_bench', name: 'BenchPage', path: '/bench', traits: traits.map((t) => ({ ref: t.name, refId: t.id })) }];
  return { schema, traits: traits.map((t) => String(t.name)) };
}

export interface DeviceWorkloadSources {
  /** Folder of scenario fixtures, the one R1 reads (`orbital-rust/crates/orbital-core/crates/runtime/tests/fixtures/parity`). */
  fixturesDir: string;
  /** Name of the fixture whose first scenario the dispatch loop cycles through. */
  dispatchFixture: string;
  /** A resolved schema with a frame-ticking trait first (`orbital-ffi/tests/fixtures/resolved/tick-counter.json`). */
  tickSchemaPath: string;
}

export async function buildDeviceWorkloads(sources: DeviceWorkloadSources): Promise<DeviceWorkloadSpec[]> {
  const fixtures = await loadScenarioFixtures(sources.fixturesDir);
  const fixture = fixtures.find((f) => f.name === sources.dispatchFixture);
  if (fixture === undefined) throw new Error(`no fixture "${sources.dispatchFixture}" in ${sources.fixturesDir}`);
  const scenario = fixture.scenarios[0];
  if (scenario === undefined) throw new Error(`fixture "${fixture.name}" has no scenario`);
  const dispatch: DispatchWorkloadSpec = {
    id: 'dispatch-1e4',
    kind: 'dispatch',
    schema: JSON.parse(JSON.stringify(fixture.schema)) as JsonValue,
    orbital: scenario.orbital,
    steps: scenario.steps.map((s) => ({ trait: s.trait, event: s.event, payload: s.payload ?? {} })),
    events: DISPATCH_EVENTS,
  };
  const tickBase = JSON.parse(await readFile(sources.tickSchemaPath, 'utf8')) as JsonValue;
  const frames: FrameWorkloadSpec[] = FRAME_COUNTS.map((ticks) => {
    const built = buildFrameSchema(tickBase, ticks);
    return { id: `frame-60hz-${ticks}`, kind: 'frame', schema: built.schema, bootTraits: built.traits, ticks, frames: FRAMES_PER_RUN, frameStepMs: FRAME_STEP_MS };
  });
  return [dispatch, ...frames];
}

/** Writes one `<id>.json` per workload into `outDir`; the Swift and Kotlin bench hosts read exactly these. */
export async function writeDeviceWorkloads(outDir: string, sources: DeviceWorkloadSources): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const files: string[] = [];
  for (const spec of await buildDeviceWorkloads(sources)) {
    const file = join(outDir, `${spec.id}.json`);
    await writeFile(file, JSON.stringify(spec));
    files.push(file);
  }
  return files;
}
