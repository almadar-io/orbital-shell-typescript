import { describe, expect, it } from 'vitest';
import { boundaryPayloads, boundaryVariants, formatBoundaryRows, packWire, runBoundaryMicro, unpackWire, type BoundaryVariant } from '../src/f3b-boundary.js';

describe('F3b boundary micro row', () => {
  it('every variant round-trips every payload to the same value', () => {
    for (const p of boundaryPayloads()) {
      for (const variant of Object.keys(boundaryVariants) as BoundaryVariant[]) {
        expect(boundaryVariants[variant](p.value), `${p.name}/${variant}`).toEqual(p.value);
      }
    }
  });

  it('the payloads have the sizes the design asks for', () => {
    const sizes = Object.fromEntries(boundaryPayloads().map((p) => [p.name, p.jsonBytes]));
    expect(sizes['wire-0.5KB']).toBeGreaterThanOrEqual(500);
    expect(sizes['wire-0.5KB']).toBeLessThan(700);
    expect(sizes['wire-50KB']).toBeGreaterThanOrEqual(50_000);
    expect(sizes['rows-1000']).toBeGreaterThan(sizes['rows-20'] * 40);
  });

  it('control: the binary codec keeps null, false, unicode and nested empties distinct', () => {
    const value = { a: null, b: false, c: 'héllo ✓', d: [], e: {}, f: [[], [null]], g: -1.25 };
    expect(unpackWire(packWire(value))).toEqual(value);
    expect(() => unpackWire(Uint8Array.of(0x00))).toThrow(/unknown tag/);
  });

  it('times all variants of all payloads once at a small iteration count', () => {
    const rows = runBoundaryMicro({ iterations: 3, warmup: 1 });
    expect(rows).toHaveLength(15);
    for (const r of rows) expect(r.medianMs).toBeGreaterThan(0);
    expect(rows.filter((r) => r.variant === 'json').every((r) => r.vsJson === 1)).toBe(true);
    expect(formatBoundaryRows(rows)).toContain('rows-1000');
  });
});
