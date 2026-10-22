import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadKernelModule } from '@almadar/shell-node';
import { formatWriteHeavy, planWriteMix, runWriteHeavyRow } from '../src/write-heavy-rows.js';

const PACKAGE_ROOT: string = fileURLToPath(new URL('..', import.meta.url));

const kernelDir = process.env.ALMADAR_KERNEL_DIR;

describe('planWriteMix', () => {
  it('is deterministic and close to 80/10/10', () => {
    const a = planWriteMix(2000, 100);
    expect(planWriteMix(2000, 100)).toEqual(a);
    const share = (op: string): number => a.filter((p) => p.op === op).length / a.length;
    expect(share('update')).toBeGreaterThan(0.75);
    expect(share('update')).toBeLessThan(0.85);
    expect(share('create')).toBeGreaterThan(0.06);
    expect(share('batch')).toBeGreaterThan(0.06);
  });

  it('control: created ids never collide with seeded rows or each other', () => {
    const ids = planWriteMix(500, 100).flatMap((p) => (p.op === 'update' ? [] : p.op === 'create' ? [String(p.payload.id)] : [String(p.payload.a), String(p.payload.b), String(p.payload.c)]));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(Number(id.slice(5))).toBeGreaterThan(100);
  });
});

describe('write-heavy row smoke (installed kernel)', () => {
  it('runs the mix, keeps every write, and records adapter calls per op', async () => {
    const r = await runWriteHeavyRow({ engine: 'kernel', tableRows: 50, ops: 60 });
    expect(r.row).toBe('B1-kernel-write-heavy');
    expect(r.errors).toBe(0);
    expect(r.finalRows).toBe(r.expectedRows);
    const update = r.byOp.update;
    expect(update).not.toBeNull();
    expect(update?.totalCallsPerOp).toBeGreaterThan(0);
    // The kernel pushes a batch down as one conditional write; every one of its rows lands.
    expect(r.byOp.batch?.callsPerOp.writeBatch).toBe(1);
    expect(r.byOp.batch?.callsPerOp.create).toBeUndefined();
    expect(formatWriteHeavy(r)).toContain('calls/op');
  });

});

describe.skipIf(kernelDir === undefined)('write-heavy row smoke (kernel host)', () => {
  it('keeps every write on the kernel host', async () => {
    const kernel = await loadKernelModule(kernelDir ?? '', { languageFrom: PACKAGE_ROOT });
    const r = await runWriteHeavyRow({ engine: 'kernel', kernel, tableRows: 50, ops: 60 });
    expect(r.row).toBe('B1-kernel-write-heavy');
    expect(r.errors).toBe(0);
    expect(r.finalRows).toBe(r.expectedRows);
  });
});
