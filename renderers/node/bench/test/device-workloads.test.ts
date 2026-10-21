import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../src/types.js';
import { buildFrameSchema } from '../src/device-workloads.js';

const base: JsonValue = {
  name: 'base',
  ledger: { entries: {} },
  orbitals: [{
    name: 'O',
    pages: [],
    traits: [
      { id: 't0', name: 'Ticker', emits: [{ event: 'BEAT' }], ticks: [{ name: 'beat', interval: 1000 }, { name: 'frameTick', interval: 'frame' }] },
      { id: 't1', name: 'Listener' },
    ],
  }],
};

describe('buildFrameSchema', () => {
  it('clones the ticking trait with one frame tick each and drops the rest', () => {
    const { schema, traits } = buildFrameSchema(base, 3);
    expect(traits).toEqual(['FrameTicker0', 'FrameTicker1', 'FrameTicker2']);
    const orbital = (schema as { orbitals: { traits: { id: string; ticks: { interval: string }[]; emits?: unknown }[] }[] }).orbitals[0];
    expect(orbital.traits.map((t) => t.id)).toEqual(['trt_bench_0', 'trt_bench_1', 'trt_bench_2']);
    for (const t of orbital.traits) {
      expect(t.ticks).toEqual([{ name: 'frameTick', interval: 'frame' }]);
      expect(t.emits).toBeUndefined();
    }
  });

  it('does not mutate the base schema', () => {
    buildFrameSchema(base, 2);
    expect((base as { orbitals: { traits: unknown[] }[] }).orbitals[0].traits).toHaveLength(2);
  });

  it('rejects a non-positive count and a base without a frame tick', () => {
    expect(() => buildFrameSchema(base, 0)).toThrow(/positive integer/);
    const noFrame: JsonValue = { orbitals: [{ traits: [{ ticks: [{ interval: 1000 }] }] }] };
    expect(() => buildFrameSchema(noFrame, 1)).toThrow(/frame tick/);
  });
});
