import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { packageFixturesDir } from '../src/package-root.js';
import { loadScenarioFixtures } from '../src/fixtures.js';
import { createB1KernelHarness } from '../src/b1-kernel-harness.js';
import { createR2Harness } from '../src/r2-harness.js';
import { applyClockFields, compareTraces } from '../src/trace.js';
import type { Scenario, ScenarioFixture, ScenarioHarness, Trace } from '../src/types.js';

const kernelDir = process.env.ALMADAR_KERNEL_DIR;
const cascadeDir = process.env.ALMADAR_PARITY_CASCADE_FIXTURES;

async function traceOf(harness: ScenarioHarness, fixture: ScenarioFixture, scenario: Scenario): Promise<Trace> {
  const session = await harness.open(fixture, scenario);
  const steps: Trace['steps'] = [];
  try {
    for (const step of scenario.steps) steps.push(await session.dispatch(step));
  } finally {
    await session.close();
  }
  return { steps };
}

describe('R2 harness availability', () => {
  it('control: without a kernel directory the row is unavailable, never a silent fallback', async () => {
    expect(await createR2Harness(undefined).isAvailable()).toBe(false);
  });

  it('control: a directory with no @almadar/kernel build is unavailable', async () => {
    expect(await createR2Harness(join(packageFixturesDir(), 'scenarios')).isAvailable()).toBe(false);
  });
});

describe.skipIf(kernelDir === undefined)('R2 harness (@almadar/kernel in Node)', () => {
  const r2 = createR2Harness(kernelDir);
  const b1 = createB1KernelHarness(process.env.ALMADAR_KERNEL_DIR);

  it('is available and labelled R2', async () => {
    expect(r2.id).toBe('R2');
    expect(await r2.isAvailable()).toBe(true);
  });

  it('in-package fixture: the R2 trace equals the B1 trace', async () => {
    const [fixture] = await loadScenarioFixtures(join(packageFixturesDir(), 'scenarios'));
    for (const scenario of fixture.scenarios) {
      const want = await traceOf(b1, fixture, scenario);
      const got = await traceOf(r2, fixture, scenario);
      expect(compareTraces(applyClockFields(want, fixture.clockFields), applyClockFields(got, fixture.clockFields))).toBeNull();
    }
  });

  it('control: an unknown trait is a failed step, never an empty trace', async () => {
    const [fixture] = await loadScenarioFixtures(join(packageFixturesDir(), 'scenarios'));
    const session = await r2.open(fixture, fixture.scenarios[0]);
    await expect(session.dispatch({ trait: 'Nope', event: 'GO', payload: {} })).rejects.toThrow(/Nope/);
    await session.close();
  });

  describe.skipIf(cascadeDir === undefined)('parity fixtures', () => {
    it('dispatch-roots: the R2 trace equals the B1 trace', async () => {
      const fixtures = await loadScenarioFixtures(cascadeDir ?? '');
      const fixture = fixtures.find((f) => f.name === 'dispatch-roots');
      if (fixture === undefined) throw new Error('dispatch-roots fixture missing');
      const scenario = fixture.scenarios[0];
      const want = await traceOf(b1, fixture, scenario);
      const got = await traceOf(r2, fixture, scenario);
      expect(compareTraces(applyClockFields(want, fixture.clockFields), applyClockFields(got, fixture.clockFields))).toBeNull();
    });

    it('retry-guard: the R2 trace equals the B1 trace', async () => {
      const fixtures = await loadScenarioFixtures(cascadeDir ?? '');
      const fixture = fixtures.find((f) => f.name === 'retry-guard');
      if (fixture === undefined) throw new Error('retry-guard fixture missing');
      const scenario = fixture.scenarios[0];
      const want = await traceOf(b1, fixture, scenario);
      const got = await traceOf(r2, fixture, scenario);
      const difference = compareTraces(applyClockFields(want, fixture.clockFields), applyClockFields(got, fixture.clockFields));
      expect(difference).toBeNull();
    });
  });
});
