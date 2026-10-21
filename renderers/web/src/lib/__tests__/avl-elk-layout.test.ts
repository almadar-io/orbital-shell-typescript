import { describe, it, expect } from 'vitest';
import { computeTraitLayout, type TraitLayoutMetrics } from '../avl-elk-layout';
import type { TraitLevelData } from '../avl-schema-parser';

const METRICS: TraitLayoutMetrics = {
  nodeSize: () => ({ width: 120, height: 44 }),
  labelSize: () => ({ width: 60, height: 24 }),
  nodeSpacing: 40,
  layerSpacing: 88,
  orthogonal: true,
  direction: 'ltr',
};

// Declared out of flow order and cyclic, so the layout must not follow declaration order.
const CYCLIC: TraitLevelData = {
  name: 'OrderFlow',
  linkedEntity: 'Order',
  states: [
    { name: 'saving', isInitial: false, isTerminal: false },
    { name: 'confirmed', isInitial: false, isTerminal: true },
    { name: 'browsing', isInitial: true, isTerminal: false },
    { name: 'editing', isInitial: false, isTerminal: false },
  ],
  transitions: [
    { from: 'saving', to: 'confirmed', event: 'SAVED', guard: null, effects: [], index: 0 },
    { from: 'confirmed', to: 'browsing', event: 'DONE', guard: null, effects: [], index: 1 },
    { from: 'browsing', to: 'editing', event: 'EDIT', guard: null, effects: [], index: 2 },
    { from: 'editing', to: 'saving', event: 'SAVE', guard: null, effects: [], index: 3 },
    { from: 'editing', to: 'browsing', event: 'CANCEL', guard: null, effects: [], index: 4 },
  ],
  emittedEvents: [],
  listenedEvents: [],
};

describe('computeTraitLayout with renderer metrics', () => {
  it('reads left→right from the initial state along the flow', async () => {
    const layout = await computeTraitLayout(CYCLIC, METRICS);
    const x = (id: string) => layout.nodes.find((n) => n.id === id)!.x;
    expect(x('browsing')).toBeLessThan(x('editing'));
    expect(x('editing')).toBeLessThan(x('saving'));
    expect(x('saving')).toBeLessThan(x('confirmed'));
  });

  it('reads right→left when the direction is rtl', async () => {
    const layout = await computeTraitLayout(CYCLIC, { ...METRICS, direction: 'rtl' });
    const x = (id: string) => layout.nodes.find((n) => n.id === id)!.x;
    expect(x('browsing')).toBeGreaterThan(x('editing'));
    expect(x('saving')).toBeGreaterThan(x('confirmed'));
    expect(layout.edges.filter((e) => e.isBackward).map((e) => e.event).sort()).toEqual(['CANCEL', 'DONE']);
  });

  it('marks exactly the flow-reversing transitions as backward', async () => {
    const layout = await computeTraitLayout(CYCLIC, METRICS);
    expect(layout.edges.filter((e) => e.isBackward).map((e) => e.event).sort()).toEqual(['CANCEL', 'DONE']);
  });

  it('sits every label on its own wire', async () => {
    const layout = await computeTraitLayout(CYCLIC, METRICS);
    for (const e of layout.edges) {
      const cx = e.labelX + e.labelW / 2;
      const cy = e.labelY + e.labelH / 2;
      const onWire = e.points.slice(1).some((p, i) => {
        const a = e.points[i];
        const within = (v: number, lo: number, hi: number) => v >= Math.min(lo, hi) - 1 && v <= Math.max(lo, hi) + 1;
        return (Math.abs(a.y - p.y) < 1 && Math.abs(a.y - cy) <= 2 && within(cx, a.x, p.x))
          || (Math.abs(a.x - p.x) < 1 && Math.abs(a.x - cx) <= 2 && within(cy, a.y, p.y));
      });
      expect(onWire, `${e.event} label off its wire`).toBe(true);
    }
  });
});
