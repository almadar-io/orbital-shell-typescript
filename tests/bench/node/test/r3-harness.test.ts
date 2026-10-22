import { afterAll, describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { packageFixturesDir } from '../src/package-root.js';
import { loadScenarioFixtures } from '../src/fixtures.js';
import { createB1KernelHarness } from '../src/b1-kernel-harness.js';
import { createR3Harness } from '../src/r3-harness.js';
import { applyClockFields, compareTraces } from '../src/trace.js';
import type { Scenario, ScenarioFixture, ScenarioHarness, Trace } from '../src/types.js';

const kernelDir = process.env.ALMADAR_KERNEL_DIR;
const playwrightDir = process.env.ALMADAR_PLAYWRIGHT_CORE_DIR;
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

describe('R3 harness availability', () => {
  it('control: without a kernel directory or Playwright the row is unavailable, never a silent fallback', async () => {
    expect(await createR3Harness(undefined, undefined).isAvailable()).toBe(false);
    expect(await createR3Harness(kernelDir, undefined).isAvailable()).toBe(false);
    expect(await createR3Harness(undefined, playwrightDir).isAvailable()).toBe(false);
  });
});

describe.skipIf(kernelDir === undefined || playwrightDir === undefined)('R3 harness (@almadar/kernel in headless Chromium)', () => {
  const r3 = createR3Harness(kernelDir, playwrightDir);
  const b1 = createB1KernelHarness(process.env.ALMADAR_KERNEL_DIR);
  afterAll(async () => r3.dispose?.());

  it('is available, labelled R3, and names the Chromium it ran in', async () => {
    expect(r3.id).toBe('R3');
    expect(await r3.isAvailable()).toBe(true);
    expect(r3.runtimeLabel).toMatch(/^Chromium \d+\.\d+\.\d+\.\d+ \(playwright \d+\.\d+\.\d+, cross-origin isolated timer\)$/);
    expect(r3.moduleLoadMs).toBeGreaterThan(0);
  });

  it('in-package fixture: the R3 trace equals the B1 trace, timed inside the page', async () => {
    const [fixture] = await loadScenarioFixtures(join(packageFixturesDir(), 'scenarios'));
    for (const scenario of fixture.scenarios) {
      const want = await traceOf(b1, fixture, scenario);
      const session = await r3.open(fixture, scenario);
      const steps: Trace['steps'] = [];
      for (const step of scenario.steps) {
        steps.push(await session.dispatch(step));
        expect(session.lastDispatchMs).toBeGreaterThan(0);
      }
      expect(session.openMs).toBeGreaterThan(0);
      expect((await session.sampleMemory?.())?.heapUsedBytes).toBeGreaterThan(0);
      await session.close();
      expect(compareTraces(applyClockFields(want, fixture.clockFields), applyClockFields({ steps }, fixture.clockFields))).toBeNull();
    }
  });

  it('control: an unknown trait is a failed step, never an empty trace', async () => {
    const [fixture] = await loadScenarioFixtures(join(packageFixturesDir(), 'scenarios'));
    const session = await r3.open(fixture, fixture.scenarios[0]);
    await expect(session.dispatch({ trait: 'Nope', event: 'GO', payload: {} })).rejects.toThrow(/Nope/);
    await session.close();
  });

  describe.skipIf(cascadeDir === undefined)('parity fixtures', () => {
    it.each(['dispatch-roots', 'retry-guard'])('%s: the R3 trace equals the B1 trace', async (name) => {
      const fixtures = await loadScenarioFixtures(cascadeDir ?? '');
      const fixture = fixtures.find((f) => f.name === name);
      if (fixture === undefined) throw new Error(`${name} fixture missing`);
      for (const scenario of fixture.scenarios) {
        const want = await traceOf(b1, fixture, scenario);
        const got = await traceOf(r3, fixture, scenario);
        expect(compareTraces(applyClockFields(want, fixture.clockFields), applyClockFields(got, fixture.clockFields))).toBeNull();
      }
    });

    it('fetch-payload: the client-role kernel differs from B1 in emits, recorded exactly', async () => {
      const fixtures = await loadScenarioFixtures(cascadeDir ?? '');
      const fixture = fixtures.find((f) => f.name === 'fetch-payload');
      if (fixture === undefined) throw new Error('fetch-payload fixture missing');
      const scenario = fixture.scenarios[0];
      const want = await traceOf(b1, fixture, scenario);
      const got = await traceOf(r3, fixture, scenario);
      const difference = compareTraces(applyClockFields(want, fixture.clockFields), applyClockFields(got, fixture.clockFields));
      expect(difference).toMatchObject({ stepIndex: 0, field: 'emits' });
    });
  });

  it('dispose closes the browser, and a fresh row launches its own', async () => {
    await r3.dispose?.();
    const again = createR3Harness(kernelDir, playwrightDir);
    expect(await again.isAvailable()).toBe(true);
    await again.dispose?.();
  });
});
