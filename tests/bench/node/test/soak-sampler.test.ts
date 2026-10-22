import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { runSoak, soakCsv, assessLeak, leastSquaresSlope, type SoakSample } from '../src/soak-sampler.js';
import { deviceAvailability, DEVICE_ROWS } from '../src/device-rows.js';
import type { Scenario, ScenarioSession, TraceStep } from '../src/types.js';

const scenario: Scenario = { orbital: 'O', steps: [{ trait: 'T', event: 'GO', payload: undefined }] };
const traced: TraceStep = { trait: 'T', event: 'GO', states: {}, effects: [], emits: [] };

function session(): ScenarioSession & { count: number } {
  const s = { count: 0, dispatch: async () => { s.count++; return traced; }, close: async () => {} };
  return s;
}

const mk = (events: number, heap: number, rows: number | null): SoakSample => ({ events, heapUsedBytes: heap, rssBytes: null, rowCount: rows, kernelStats: null });

describe('runSoak', () => {
  it('samples at 0, every N and the final event', async () => {
    const s = session();
    const out = await runSoak(s, scenario, { events: 12, sampleEvery: 5, readMemory: async () => ({ heapUsedBytes: s.count, rssBytes: 1 }) });
    expect(out.map((x) => x.events)).toEqual([0, 5, 10, 12]);
    expect(out.map((x) => x.heapUsedBytes)).toEqual([0, 5, 10, 12]);
    expect(out[0].kernelStats).toBeNull();
  });
  it('rejects bad sizes', async () => {
    const opts = { readMemory: async () => ({ heapUsedBytes: 0, rssBytes: null }) };
    await expect(runSoak(session(), scenario, { ...opts, events: 0 })).rejects.toThrow();
    await expect(runSoak(session(), scenario, { ...opts, events: 2_000_000 })).rejects.toThrow();
    await expect(runSoak(session(), { orbital: 'O', steps: [] }, opts)).rejects.toThrow();
  });
});

describe('soakCsv', () => {
  it('writes blanks for missing columns', () => {
    expect(soakCsv([mk(0, 10, null)]).split('\n')[1]).toBe('0,10,,,,,,,,,');
  });
});

describe('assessLeak', () => {
  const series = (slope: number, rows: (i: number) => number | null) => Array.from({ length: 10 }, (_, i) => mk(i * 1000, 1e6 + slope * i * 1000, rows(i)));
  it('flat heap is flat', () => expect(assessLeak(series(0, () => 5)).verdict).toBe('flat'));
  it('growing heap with constant rows is a leak', () => expect(assessLeak(series(100, () => 5)).verdict).toBe('leak'));
  it('growing heap with growing rows is data', () => expect(assessLeak(series(100, (i) => i)).verdict).toBe('data-growth'));
  it('growing heap with unknown rows is not called a leak', () => expect(assessLeak(series(100, () => null)).verdict).toBe('data-growth'));
  it('too few samples', () => expect(assessLeak([mk(0, 1, 1)]).verdict).toBe('insufficient-samples'));
  it('slope of a line', () => expect(leastSquaresSlope([0, 1, 2], [1, 3, 5])).toBeCloseTo(2));
});

describe('deviceAvailability', () => {
  it('reports toolchain presence but never runnable', () => {
    const out = deviceAvailability(DEVICE_ROWS, (cmd) => cmd === 'xcrun', () => true);
    expect(out.map((o) => [o.id, o.toolchain, o.runnable])).toEqual([['R1-device-ios', true, true], ['R1-device-android', false, false]]);
    expect(out[1].reason).toMatch(/toolchain/);
  });

  it('is not runnable without its bench script', () => {
    const out = deviceAvailability(DEVICE_ROWS, () => true, (path) => !path.includes('android'));
    expect(out.map((o) => o.runnable)).toEqual([true, false]);
    expect(out[1].reason).toMatch(/bench script/);
  });

  it('points every row at a bench script that exists in the repo', () => {
    for (const row of DEVICE_ROWS) expect(existsSync(join(process.cwd(), '../../../../../..', row.benchScript)), row.benchScript).toBe(true);
  });
});
