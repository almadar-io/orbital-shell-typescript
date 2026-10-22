/**
 * Coverage of the empty-transition anchoring fix in `findRenderUiRoot`
 * (gap CE-G1). Canvas selections at L1/INIT carry no `data-orb-transition`,
 * so a patch address arrives with `transition: ''`. Before the fix the
 * exact-match loop (`if (t.event !== address.transition) continue`) could
 * never match an empty string, the patch fell through to `stale`, and the
 * edit silently did not apply. The fix falls back to the first transition
 * whose effects render-ui on the addressed slot. These tests pin both the
 * empty-transition fallback and the preserved exact-match behavior.
 */

import { describe, it, expect } from 'vitest';

import {
  applyRenderOverlay,
  insertChildAtPath,
  navigatePatternPath,
  removeChildAtPath,
  replaceChildAtPath,
  type PatternNode,
  type RenderUiPatch,
} from '../src/render-ui-edit.js';
import type { OrbitalDefinition } from '../src/types/orbital.js';
import type { Trait } from '../src/types/trait.js';
import type { Transition } from '../src/types/state-machine.js';
import type { Effect } from '../src/types/effect.js';

function chartEffect(slot: 'main' | 'sidebar', chartType: string): Effect {
  return ['render-ui', slot, { type: 'chart', chartType }];
}

function renderTransition(
  from: string,
  event: string,
  effects: Effect[],
): Transition {
  return { from, to: from, event, effects };
}

function trait(name: string, transitions: Transition[]): Trait {
  return {
    name,
    scope: 'instance',
    stateMachine: {
      states: Array.from(new Set(transitions.map((t) => t.from))).map((name) => ({ name })),
      events: Array.from(new Set(transitions.map((t) => t.event))).map((key) => ({
        key,
        name: key,
      })),
      transitions,
    },
  };
}

function orbital(traitDef: Trait): OrbitalDefinition {
  return {
    name: 'BurndownOrbital',
    entity: { name: 'Point', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [traitDef],
    pages: [],
  };
}

/** The pattern config placed at index 2 of a render-ui effect (post-overlay). */
function renderedNode(t: Trait, transitionIndex: number, effectIndex = 0): unknown {
  return t.stateMachine?.transitions[transitionIndex].effects?.[effectIndex]?.[2];
}

const swapToBar: PatternNode = { type: 'chart', chartType: 'bar' };

describe('findRenderUiRoot empty-transition anchoring (CE-G1)', () => {
  it('anchors an empty-transition patch to the slot render-ui and applies it', () => {
    const t = trait('BurndownChart', [
      renderTransition('idle', 'INIT', [chartEffect('main', 'line')]),
    ]);
    const def = orbital(t);

    const patch: RenderUiPatch = {
      op: 'replace',
      address: { trait: 'BurndownChart', transition: '', slot: 'main', path: 'root' },
      node: swapToBar,
    };

    const result = applyRenderOverlay(def, [patch]);

    expect(result.applied).toBe(1);
    expect(result.stale).toHaveLength(0);
    expect(renderedNode(t, 0)).toMatchObject({ chartType: 'bar' });
  });

  it('falls back to the first slot render-ui when the transition is unknown', () => {
    const t = trait('BurndownChart', [
      renderTransition('loading', 'LOADED', [chartEffect('main', 'line')]),
      renderTransition('loading', 'REFRESH', [chartEffect('main', 'line')]),
    ]);
    const def = orbital(t);

    const result = applyRenderOverlay(def, [
      {
        op: 'replace',
        address: { trait: 'BurndownChart', transition: '', slot: 'main', path: 'root' },
        node: swapToBar,
      },
    ]);

    expect(result.applied).toBe(1);
    expect(renderedNode(t, 0)).toMatchObject({ chartType: 'bar' });
  });

  it('still prefers the EXACT transition match when transition is provided', () => {
    const t = trait('BurndownChart', [
      renderTransition('loading', 'LOADED', [chartEffect('main', 'line')]),
      renderTransition('loading', 'REFRESH', [chartEffect('main', 'area')]),
    ]);
    const def = orbital(t);

    const result = applyRenderOverlay(def, [
      {
        op: 'replace',
        address: { trait: 'BurndownChart', transition: 'REFRESH', slot: 'main', path: 'root' },
        node: swapToBar,
      },
    ]);

    expect(result.applied).toBe(1);
    expect(renderedNode(t, 0)).toMatchObject({ chartType: 'line' });
    expect(renderedNode(t, 1)).toMatchObject({ chartType: 'bar' });
  });

  it('respects the slot filter in the empty-transition fallback', () => {
    const t = trait('BurndownChart', [
      renderTransition('idle', 'INIT', [chartEffect('sidebar', 'legend')]),
      renderTransition('idle', 'INIT', [chartEffect('main', 'line')]),
    ]);
    const def = orbital(t);

    const result = applyRenderOverlay(def, [
      {
        op: 'replace',
        address: { trait: 'BurndownChart', transition: '', slot: 'main', path: 'root' },
        node: swapToBar,
      },
    ]);

    expect(result.applied).toBe(1);
    expect(renderedNode(t, 0)).toMatchObject({ chartType: 'legend' });
    expect(renderedNode(t, 1)).toMatchObject({ chartType: 'bar' });
  });

  it('respects a non-empty state filter alongside the empty-transition fallback', () => {
    const t = trait('BurndownChart', [
      renderTransition('error', 'INIT', [chartEffect('main', 'errorcard')]),
      renderTransition('idle', 'INIT', [chartEffect('main', 'line')]),
    ]);
    const def = orbital(t);

    const result = applyRenderOverlay(def, [
      {
        op: 'replace',
        address: { trait: 'BurndownChart', transition: '', state: 'idle', slot: 'main', path: 'root' },
        node: swapToBar,
      },
    ]);

    expect(result.applied).toBe(1);
    expect(renderedNode(t, 0)).toMatchObject({ chartType: 'errorcard' });
    expect(renderedNode(t, 1)).toMatchObject({ chartType: 'bar' });
  });

  it('reports stale when no slot render-ui exists for the trait', () => {
    const t = trait('BurndownChart', [
      renderTransition('idle', 'INIT', [chartEffect('main', 'line')]),
    ]);
    const def = orbital(t);

    const result = applyRenderOverlay(def, [
      {
        op: 'replace',
        address: { trait: 'BurndownChart', transition: '', slot: 'sidebar', path: 'root' },
        node: swapToBar,
      },
    ]);

    expect(result.applied).toBe(0);
    expect(result.stale).toHaveLength(1);
  });
});

describe('pattern paths as the renderer emits them (`root.children.N…`)', () => {
  const tree = (): PatternNode => ({
    type: 'stack',
    children: [
      { type: 'typography', content: 'A' },
      { type: 'stack', children: [{ type: 'badge', label: 'x' }, { type: 'badge', label: 'y' }] },
    ],
  });

  it('navigates root, a child, and a grandchild', () => {
    const t = tree();
    expect(navigatePatternPath(t, 'root')).toBe(t);
    expect(navigatePatternPath(t, 'root.children.0')?.content).toBe('A');
    expect(navigatePatternPath(t, 'root.children.1.children.1')?.label).toBe('y');
  });

  it('accepts a path without the leading root label', () => {
    expect(navigatePatternPath(tree(), 'children.1.children.0')?.label).toBe('x');
  });

  it('follows children nested under props (the form some IR passes emit)', () => {
    const t: PatternNode = { type: 'stack', props: { children: [{ type: 'badge', label: 'p' }] } };
    expect(navigatePatternPath(t, 'root.children.0')?.label).toBe('p');
  });

  it('misses cleanly: out of range, a scalar leaf, a non-children key', () => {
    const t = tree();
    expect(navigatePatternPath(t, 'root.children.5')).toBeNull();
    expect(navigatePatternPath(t, 'root.children.0.content')).toBeNull();
    expect(navigatePatternPath(t, 'root.children.-1')).toBeNull();
  });

  it('removes, replaces and inserts at nested paths (the parent of root.children.1 is root)', () => {
    const t = tree();
    expect(removeChildAtPath(t, 'root.children.0')).toBe(true);
    expect(t.children?.map((c) => (typeof c === 'string' ? c : c.type))).toEqual(['stack']);
    expect(replaceChildAtPath(t, 'root.children.0.children.0', { type: 'icon', name: 'star' })).toBe(true);
    expect(navigatePatternPath(t, 'root.children.0.children.0')?.type).toBe('icon');
    expect(insertChildAtPath(t, 'root.children.0', 1, { type: 'divider' })).toBe(true);
    expect(navigatePatternPath(t, 'root.children.0')?.children?.map((c) => (typeof c === 'string' ? c : c.type))).toEqual(['icon', 'divider', 'badge']);
  });

  it('a structural op on a path that is not a child path refuses', () => {
    const t = tree();
    expect(removeChildAtPath(t, 'root')).toBe(false);
    expect(replaceChildAtPath(t, 'root.children.9', { type: 'x' })).toBe(false);
    expect(t.children).toHaveLength(2);
  });
});

describe('a trait embed (`@trait.X`) in children is a leaf, never a node', () => {
  it('navigating onto an embed misses; siblings after it still resolve', () => {
    const t: PatternNode = { type: 'stack', children: ['@trait.Toolbar', { type: 'typography', content: 'Notes' }] };
    expect(navigatePatternPath(t, 'root.children.0')).toBeNull();
    expect(navigatePatternPath(t, 'root.children.1')?.content).toBe('Notes');
  });

  it('an embed can be moved/removed like any child', () => {
    const t: PatternNode = { type: 'stack', children: ['@trait.A', '@trait.B'] };
    expect(removeChildAtPath(t, 'root.children.0')).toBe(true);
    expect(t.children).toEqual(['@trait.B']);
  });
});
