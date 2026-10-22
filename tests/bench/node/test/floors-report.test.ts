import { describe, expect, it } from 'vitest';
import { renderReport } from '../src/report.js';
import type { BenchResult, WorkloadResult } from '../src/bench.js';

const timed = (key: string, p50Ms: number): WorkloadResult => ({
  key,
  fixture: 'large-table-list',
  scenario: '(a) filtered ordered page',
  status: 'timed',
  trace: { steps: [] },
  timing: {
    eventLatency: { p50Ms, p99Ms: p50Ms, minMs: p50Ms, maxMs: p50Ms, samples: 10, medianOfRunMediansMs: p50Ms, runMedianSpreadMs: { min: p50Ms, max: p50Ms } },
    stepsPerSecond: 1,
    mountMedianMs: 1,
    coldStart: { moduleLoadMs: 1, initMs: 1, firstDispatchMs: 1, totalMs: 3 },
    memory: { afterMount: { heapUsedBytes: 1, rssBytes: 1 }, afterEvents: null, events: 1 },
  },
});

const row = (harness: string, p50Ms: number): BenchResult => ({
  harness,
  harnessName: harness,
  reference: 'none',
  commits: {},
  environment: { node: 'v22', platform: 'darwin', arch: 'arm64', cpuModel: 'M', cpuCount: 8, loadAverage: [0, 0, 0], note: '' },
  warmupRuns: 1,
  measuredRuns: 1,
  workloads: [timed('large-table-list#0', p50Ms)],
});

describe('floors section', () => {
  it('lists current, floor and the gap between them per workload', () => {
    const md = renderReport([row('R0', 10), row('F1', 4), row('B1-kernel', 40), row('F2', 16), row('F3', 8)]);
    expect(md).toContain('## Floors: current vs reachable');
    expect(md).toContain('| large-table-list / (a) filtered ordered page | 10.0000 | 4.0000 | 6.0000 | 40.0000 | 16.0000 | 8.0000 | 24.0000 | 50% |');
  });

  it('control: without any floor row there is no floors section, and a missing row shows a dash', () => {
    expect(renderReport([row('R0', 10), row('B1-kernel', 40)])).not.toContain('## Floors');
    const md = renderReport([row('F2', 16)]);
    expect(md).toContain('| large-table-list / (a) filtered ordered page | - | - | - | - | 16.0000 | - | - | - |');
  });
});
