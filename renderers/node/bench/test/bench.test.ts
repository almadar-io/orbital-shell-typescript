import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareResults, percentile, referenceFromHarness, referenceFromResultFile, runBench } from '../src/bench.js';
import { registerHarness, createHarnessById, registeredHarnessIds } from '../src/registry.js';
import type { Scenario, ScenarioFixture, ScenarioHarness, ScenarioSession, ScenarioStep, TraceStep } from '../src/types.js';

const fixture: ScenarioFixture = {
  name: 'fake',
  schema: { name: 'fake', orbitals: [] },
  clockFields: [], mintedIdFields: [],
  scenarios: [
    { name: 'two', orbital: 'Main', steps: [{ trait: 'T', event: 'A', payload: {} }, { trait: 'T', event: 'B', payload: {} }] },
  ],
};

class FakeHarness implements ScenarioHarness {
  readonly name: string;
  readonly measuredPackages: readonly string[] = [];
  opens = 0;
  constructor(readonly id: string, private readonly finalState: string) {
    this.name = `fake ${id}`;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async open(_f: ScenarioFixture, _s: Scenario): Promise<ScenarioSession> {
    this.opens += 1;
    const finalState = this.finalState;
    return {
      dispatch: async (step: ScenarioStep): Promise<TraceStep> => ({
        trait: step.trait,
        event: step.event,
        states: { T: step.event === 'B' ? finalState : 'mid' },
        effects: [],
        emits: [],
      }),
      close: async () => undefined,
    };
  }
}

const small = { warmupRuns: 2, measuredRuns: 5, memoryEvents: 20, commits: {} };

describe('percentile', () => {
  it('nearest-rank, with a control at the edges', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 99)).toBe(10);
    expect(percentile([7], 50)).toBe(7);
    expect(() => percentile([], 50)).toThrow();
  });
});

describe('runBench', () => {
  it('times a workload whose trace equals the reference, with the specified warm-up and run counts', async () => {
    const reference = new FakeHarness('R0', 'end');
    const subject = new FakeHarness('X', 'end');
    const refs = await referenceFromHarness(reference, [fixture]);
    const result = await runBench({ harness: subject, fixtures: [fixture], references: refs, referenceLabel: 'R0', ...small });
    const [workload] = result.workloads;
    expect(workload.status).toBe('timed');
    expect(workload.timing?.eventLatency.samples).toBe(5 * 2);
    expect(workload.timing?.memory.events).toBe(20);
    expect(workload.timing?.memory.afterEvents).not.toBeNull();
    expect(workload.timing?.coldStart.totalMs).toBeGreaterThanOrEqual(0);
    expect(workload.key).toBe('fake#0');
    expect(subject.opens).toBe(1 + 2 + 5 + 1);
  });

  it('control: a diverging trace records the first differing step and never a time', async () => {
    const refs = await referenceFromHarness(new FakeHarness('R0', 'end'), [fixture]);
    const result = await runBench({ harness: new FakeHarness('X', 'wrong'), fixtures: [fixture], references: refs, referenceLabel: 'R0', ...small });
    const [workload] = result.workloads;
    expect(workload.status).toBe('parityFailure');
    expect(workload.timing).toBeUndefined();
    expect(workload.parityFailure).toMatchObject({ stepIndex: 1, field: 'states' });
  });

  it('a workload without a reference trace is an error, not a time', async () => {
    const result = await runBench({ harness: new FakeHarness('X', 'end'), fixtures: [fixture], references: new Map(), referenceLabel: 'R0', ...small });
    expect(result.workloads[0].status).toBe('error');
    expect(result.workloads[0].timing).toBeUndefined();
  });

  it('a result file serves as a reference', async () => {
    const first = await runBench({
      harness: new FakeHarness('R0', 'end'),
      fixtures: [fixture],
      references: await referenceFromHarness(new FakeHarness('R0', 'end'), [fixture]),
      referenceLabel: 'self',
      ...small,
    });
    const file = join(mkdtempSync(join(tmpdir(), 'bench-')), 'r0.json');
    writeFileSync(file, JSON.stringify(first));
    const refs = await referenceFromResultFile(file);
    const ok = await runBench({ harness: new FakeHarness('X', 'end'), fixtures: [fixture], references: refs, referenceLabel: file, ...small });
    expect(ok.workloads[0].status).toBe('timed');
    const bad = await runBench({ harness: new FakeHarness('X', 'wrong'), fixtures: [fixture], references: refs, referenceLabel: file, ...small });
    expect(bad.workloads[0].status).toBe('parityFailure');
  });
});

class SelfTimedHarness extends FakeHarness {
  moduleLoadMs = 123;
  override async open(f: ScenarioFixture, sc: Scenario): Promise<ScenarioSession> {
    const inner = await super.open(f, sc);
    return { ...inner, lastDispatchMs: 7, openMs: 3, sampleMemory: async () => ({ heapUsedBytes: 99, rssBytes: null }) };
  }
}

describe('runBench with a self-timing harness', () => {
  it('uses the harness own dispatch, open, module-load and memory figures, and control: an outside timer would not give 7', async () => {
    const refs = await referenceFromHarness(new FakeHarness('R0', 'end'), [fixture]);
    const result = await runBench({ harness: new SelfTimedHarness('R3', 'end'), fixtures: [fixture], references: refs, referenceLabel: 'R0', ...small });
    const timing = result.workloads[0].timing;
    expect(timing?.eventLatency.p50Ms).toBe(7);
    expect(timing?.mountMedianMs).toBe(3);
    expect(timing?.coldStart).toMatchObject({ moduleLoadMs: 123, initMs: 3, firstDispatchMs: 7, totalMs: 133 });
    expect(timing?.memory.afterMount).toEqual({ heapUsedBytes: 99, rssBytes: null });
    const plain = await runBench({ harness: new FakeHarness('X', 'end'), fixtures: [fixture], references: refs, referenceLabel: 'R0', ...small });
    expect(plain.workloads[0].timing?.eventLatency.p50Ms).toBeLessThan(7);
  });
});

describe('compareResults', () => {
  it('reports equal, differing and missing workloads between two result files, control: identical files are all equal', async () => {
    const make = async (finalState: string, id: string) =>
      runBench({ harness: new FakeHarness(id, finalState), fixtures: [fixture], references: await referenceFromHarness(new FakeHarness(id, finalState), [fixture]), referenceLabel: id, ...small });
    const a = await make('end', 'A');
    const b = await make('wrong', 'B');
    expect(compareResults(a, a, [fixture]).map((d) => d.outcome)).toEqual(['equal']);
    const [diff] = compareResults(a, b, [fixture]);
    expect(diff.outcome).toBe('differs');
    expect(diff.difference).toMatchObject({ stepIndex: 1, field: 'states' });
    const empty = { ...b, workloads: [] };
    expect(compareResults(a, empty, [fixture])[0]).toMatchObject({ outcome: 'unavailable' });
  });
});

describe('harness registry', () => {
  it('a new row registers without touching bench code, duplicates are refused', async () => {
    registerHarness('R9-test', () => new FakeHarness('R9-test', 'end'));
    expect(registeredHarnessIds()).toContain('R9-test');
    expect(createHarnessById('R9-test').id).toBe('R9-test');
    expect(() => registerHarness('R9-test', () => new FakeHarness('R9-test', 'end'))).toThrow(/already registered/);
    expect(() => createHarnessById('nope')).toThrow(/unknown harness/);
    expect(registeredHarnessIds()).toContain('B1-kernel');
  });
});
