/**
 * elkjs is 1.6 MB of the playground's initial JavaScript, but only a state-machine diagram needs
 * it. The layout module loads it on the first layout, not when the module is imported.
 */
import { describe, it, expect, vi } from 'vitest';
import type { TraitLevelData } from '../avl-schema-parser';

const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock('elkjs/lib/elk.bundled.js', async (importOriginal) => {
  loads.count++;
  return importOriginal();
});

const TWO_STATES: TraitLevelData = {
  name: 'Toggle',
  linkedEntity: 'Switch',
  states: [
    { name: 'off', isInitial: true, isTerminal: false },
    { name: 'on', isInitial: false, isTerminal: false },
  ],
  transitions: [
    { from: 'off', to: 'on', event: 'FLIP', guard: null, effects: [], index: 0 },
    { from: 'on', to: 'off', event: 'FLIP', guard: null, effects: [], index: 1 },
  ],
  emittedEvents: [],
  listenedEvents: [],
};

describe('avl-elk-layout — elkjs is loaded on demand', () => {
  it('importing the layout module does not load elkjs', async () => {
    const layout = await import('../avl-elk-layout');
    expect(layout.stateWidth(1)).toBe(110);
    expect(loads.count).toBe(0);
  });

  it('the first layout loads elkjs once, and later layouts reuse it', async () => {
    const { computeTraitLayout } = await import('../avl-elk-layout');
    const first = await computeTraitLayout(TWO_STATES);
    const second = await computeTraitLayout(TWO_STATES);
    expect(loads.count).toBe(1);
    expect(first.nodes.map((n) => n.id).sort()).toEqual(['off', 'on']);
    expect(second.nodes).toEqual(first.nodes);
  });
});
