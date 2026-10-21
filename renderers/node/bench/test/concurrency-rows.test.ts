import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadKernelModule } from '@almadar/shell-node';
import type { KernelModule } from '@almadar/shell-web';
import { formatConcurrencySweep, runConcurrencyRow, runConcurrencySweep, saturationPoint, type ConcurrencyRowResult } from '../src/concurrency-rows.js';

const kernelDir = process.env.ALMADAR_KERNEL_DIR;

const row = (clients: number, p99Ms: number, throughputPerSec: number, errors = 0): ConcurrencyRowResult => ({
  row: 'B1-kernel-conc', clients, events: clients, wallMs: 1, throughputPerSec, p50Ms: 1, p95Ms: 1, p99Ms, errors, invariantViolations: 0, peakInFlight: clients, fallbackNotices: {},
});

const PACKAGE_ROOT: string = fileURLToPath(new URL('..', import.meta.url));

describe('saturationPoint', () => {
  it('picks the highest N within the p99 budget', () => {
    expect(saturationPoint([row(1, 5, 100), row(8, 20, 400), row(64, 49, 900), row(256, 300, 950)], 50)).toEqual({ clients: 64, throughputPerSec: 900 });
  });

  it('control: null when even N=1 is over budget; an errored row never counts', () => {
    expect(saturationPoint([row(1, 80, 10)], 50)).toBeNull();
    expect(saturationPoint([row(1, 5, 100), row(8, 5, 400, 1)], 50)).toEqual({ clients: 1, throughputPerSec: 100 });
  });
});

describe('B1-kernel-conc smoke (installed kernel)', () => {
  it('closed loop: no lost update, nothing in flight at the end, one latency sample per event', async () => {
    const r = await runConcurrencyRow({ engine: 'kernel', clients: 8, eventsPerClient: 3, latencyMs: 1, arrivalIntervalMs: 0 });
    expect(r.row).toBe('B1-kernel-conc');
    expect(r.events).toBe(24);
    expect(r.errors).toBe(0);
    expect(r.invariantViolations).toBe(0);
    expect(r.peakInFlight).toBeGreaterThan(1);
    expect(r.p99Ms).toBeGreaterThanOrEqual(r.p50Ms);
    expect(r.throughputPerSec).toBeGreaterThan(0);
  });

  it('open loop with a schedule runs and reports latency from the scheduled instant', async () => {
    const r = await runConcurrencyRow({ engine: 'kernel', clients: 4, eventsPerClient: 2, latencyMs: 0, arrivalIntervalMs: 5 });
    expect(r.errors).toBe(0);
    expect(r.events).toBe(8);
  });

  it('sweep covers each N and formats a table', async () => {
    const sweep = await runConcurrencySweep({ engine: 'kernel', eventsPerClient: 1, latencyMs: 0, arrivalIntervalMs: 0 }, [1, 8]);
    expect(sweep.results.map((r) => r.clients)).toEqual([1, 8]);
    expect(formatConcurrencySweep(sweep)).toContain('saturation:');
  });

});

describe.skipIf(kernelDir === undefined)('B1-kernel-conc smoke', () => {
  it('runs the same fixture on the kernel host with no lost update', async () => {
    const kernel: KernelModule = await loadKernelModule(kernelDir ?? '', { languageFrom: PACKAGE_ROOT });
    const r = await runConcurrencyRow({ engine: 'kernel', kernel, clients: 8, eventsPerClient: 3, latencyMs: 1, arrivalIntervalMs: 0 });
    expect(r.row).toBe('B1-kernel-conc');
    expect(r.errors).toBe(0);
    expect(r.invariantViolations).toBe(0);
  });
});
