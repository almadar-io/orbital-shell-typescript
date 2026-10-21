import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runBench } from '../src/bench.js';
import { createF2Harness, createF3Harness } from '../src/floor-harnesses.js';
import { buildLargeTableFixtures } from '../src/large-table.js';
import type { ScenarioFixture } from '../src/types.js';

const kernelDir = process.env.ALMADAR_KERNEL_DIR ?? resolve(__dirname, '../../../../../orbital-wasm/js');
const kernelBuilt = existsSync(join(kernelDir, 'pkg/orbital_wasm_bg.wasm'));

const small = (): ScenarioFixture[] => buildLargeTableFixtures({ rows: 300, seed: 3 });

describe('floor rows are ungated', () => {
  it('declare themselves ungated so no reference trace is compared', () => {
    expect(createF2Harness(undefined).ungated).toBe(true);
    expect(createF3Harness(undefined).ungated).toBe(true);
  });

  it('are unavailable without a kernel directory', async () => {
    expect(await createF2Harness(undefined).isAvailable()).toBe(false);
    expect(await createF3Harness(undefined).isAvailable()).toBe(false);
  });
});

describe.skipIf(!kernelBuilt)('floor rows on the built kernel', () => {
  it('F2 times every large-table workload without a reference, with a positive per-step latency', async () => {
    const result = await runBench({
      harness: createF2Harness(kernelDir),
      fixtures: small(),
      references: new Map(),
      referenceLabel: 'none (floor row)',
      commits: {},
      warmupRuns: 1,
      measuredRuns: 3,
      memoryEvents: 1,
    });
    expect(result.workloads.map((w) => w.status)).toEqual(['timed', 'timed', 'timed', 'timed', 'timed', 'timed']);
    for (const w of result.workloads) expect(w.timing?.eventLatency.p50Ms ?? 0).toBeGreaterThan(0);
  });

  it('F3 times the same workloads from the recorded sizes, with no reference', async () => {
    const fixtures = small();
    const result = await runBench({
      harness: createF3Harness(kernelDir),
      fixtures,
      references: new Map(),
      referenceLabel: 'none (floor row)',
      commits: {},
      warmupRuns: 1,
      measuredRuns: 3,
      memoryEvents: 1,
    });
    expect(result.workloads.every((w) => w.status === 'timed')).toBe(true);
  });

  it('control: a gated row with no reference trace is an error, a floor row is not', async () => {
    const { createB1KernelHarness } = await import('../src/b1-kernel-harness.js');
    const result = await runBench({
      harness: createB1KernelHarness(process.env.ALMADAR_KERNEL_DIR),
      fixtures: small().slice(1),
      references: new Map(),
      referenceLabel: 'none',
      commits: {},
      warmupRuns: 0,
      measuredRuns: 1,
      memoryEvents: 1,
    });
    expect(result.workloads.every((w) => w.status === 'error')).toBe(true);
  });
});
