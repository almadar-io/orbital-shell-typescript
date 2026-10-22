import { describe, it, expect } from 'vitest';
import { renderReport } from '../src/report.js';
import type { BenchResult, WorkloadResult } from '../src/bench.js';

const timed = (key: string): WorkloadResult => ({
  key,
  fixture: 'emit-fanout',
  scenario: 'go',
  status: 'timed',
  trace: { steps: [] },
  timing: {
    eventLatency: { p50Ms: 0.1, p99Ms: 0.5, minMs: 0.05, maxMs: 0.9, samples: 100, medianOfRunMediansMs: 0.11, runMedianSpreadMs: { min: 0.09, max: 0.13 } },
    stepsPerSecond: 9000,
    mountMedianMs: 1,
    coldStart: { moduleLoadMs: 5, initMs: 1, firstDispatchMs: 2, totalMs: 8 },
    memory: { afterMount: { heapUsedBytes: 10 * 1048576, rssBytes: 50 * 1048576 }, afterEvents: { heapUsedBytes: 12 * 1048576, rssBytes: 52 * 1048576 }, events: 10000 },
  },
});

const result = (harness: string, workloads: WorkloadResult[]): BenchResult => ({
  harness,
  harnessName: `impl ${harness}`,
  reference: 'R0',
  commits: { '@almadar/runtime': { sha: 'abc' }, other: { sha: null, reason: 'no git' } },
  environment: { node: 'v22', platform: 'darwin', arch: 'arm64', cpuModel: 'M', cpuCount: 8, loadAverage: [0, 0, 0], note: 'ac power' },
  warmupRuns: 5,
  measuredRuns: 50,
  workloads,
});

describe('renderReport', () => {
  it('renders rows in R0..B1-kernel order with timed cells, parity failures and gaps', () => {
    const md = renderReport([
      result('R3', [{ key: 'emit-fanout#0', fixture: 'emit-fanout', scenario: 'go', status: 'parityFailure', trace: null, parityFailure: { stepIndex: 1, field: 'emits', expected: [], actual: [] } }]),
      result('B1-kernel', [timed('emit-fanout#0')]),
    ]);
    const rowOrder = ['| R0 |', '| R1 |', '| R2 |', '| R3 |', '| B1-kernel |'].map((m) => md.indexOf(m, md.indexOf('## Per-event latency')));
    expect([...rowOrder].sort((a, b) => a - b)).toEqual(rowOrder);
    expect(md).toContain('| B1-kernel | 0.1000 / 0.5000 |');
    expect(md).toContain('| R3 | PARITY FAILURE (step 2: emits) |');
    expect(md).toContain('| R0 | not measured |');
    expect(md).toContain('9000');
    expect(md).toContain('10.0 [50.0] / 12.0 [52.0] after 10000');
    expect(md).toContain('@almadar/runtime@abc');
    expect(md).toContain('other@unknown (no git)');
  });

  it('control: a timed row never shows a parity failure, and an error is shown as an error', () => {
    const md = renderReport([result('B1-kernel', [timed('emit-fanout#0'), { key: 'k#1', fixture: 'k', scenario: 's', status: 'error', trace: null, error: 'boom' }])]);
    expect(md).not.toContain('PARITY FAILURE');
    expect(md).toContain('ERROR (boom)');
  });

  it('refuses two files for the same row', () => {
    expect(() => renderReport([result('B1-kernel', []), result('B1-kernel', [])])).toThrow(/two result files for row B1-kernel/);
  });

  it('renders bundle sizes, fresh-runtime cold starts, ratios to R0 and the parity failure list', () => {
    const r2 = result('R2', [timed('emit-fanout#0'), { key: 'k#1', fixture: 'k', scenario: 's', status: 'parityFailure', trace: null, parityFailure: { stepIndex: 0, field: 'emits', expected: [{ a: 1 }], actual: [] } }]);
    r2.measurements = {
      bundle: [{ file: 'pkg/x.wasm', rawBytes: 2097152, gzipBytes: 1048576, brotliBytes: 524288 }],
      coldStart: [{ fixture: 'emit-fanout', scenario: 'go', samples: [{ moduleLoadMs: 10, initMs: 1, firstDispatchMs: 1, totalMs: 12 }, { moduleLoadMs: 20, initMs: 1, firstDispatchMs: 1, totalMs: 22 }, { moduleLoadMs: 30, initMs: 1, firstDispatchMs: 1, totalMs: 32 }] }],
    };
    const r0 = result('R0', [timed('emit-fanout#0')]);
    r0.workloads[0].timing = { ...timed('emit-fanout#0').timing!, eventLatency: { ...timed('emit-fanout#0').timing!.eventLatency, p50Ms: 0.05 } };
    const md = renderReport([r2, r0]);
    expect(md).toContain('## Bundle size (MiB)');
    expect(md).toContain('| R2 | pkg/x.wasm | 2.000 | 1.000 | 0.500 |');
    expect(md).toContain('## Cold start in fresh runtimes (ms), median / max over 3 runs');
    expect(md).toContain('| R2 | emit-fanout / go | 22.0 / 32.0 |');
    expect(md).toContain('## p50 ratio to R0');
    expect(md).toContain('| R2 | 2.00 |');
    expect(md).toContain('## Parity failures');
    expect(md).toContain('| R2 | k / s | 1 | emits |');
  });

  it('control: with no R0 row there is no ratio table', () => {
    const md = renderReport([result('R3', [timed('emit-fanout#0')]), result('B1-kernel', [timed('emit-fanout#0')])]);
    expect(md).not.toContain('## p50 ratio to');
  });

  it('control: no measurements, no failures and a lone R0 mean none of those sections', () => {
    const md = renderReport([result('R0', [timed('emit-fanout#0')])]);
    expect(md).not.toContain('## Bundle size');
    expect(md).not.toContain('## Cold start in fresh runtimes');
    expect(md).not.toContain('## p50 ratio to R0');
    expect(md).not.toContain('## Parity failures');
  });

  it('shows a missing RSS as a dash', () => {
    const row = result('R3', [timed('emit-fanout#0')]);
    const memory = row.workloads[0].timing!.memory;
    memory.afterMount.rssBytes = null;
    const md = renderReport([row]);
    expect(md).toContain('10.0 [-] / 12.0 [52.0] after 10000');
  });
});
