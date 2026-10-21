/**
 * Evaluator output is branded as DATA so the `@trait.X` scan can skip large
 * evaluated arrays (a 400-point canvas) — but an evaluated RENDER NODE is not
 * data. `std-behavior-tour` wrapped its demo card in an `if`, so the card came
 * back from marker evaluation, got branded, and its `@trait.DemoBoardView`
 * child was never embedded (G-UI-093).
 */
import { describe, it, expect } from 'vitest';
import { RENDER_BINDING_MARKER, type RenderBindingMarker } from '@almadar/core';
import { isEvaluatorResolvedData, resolveRenderBindingMarkers } from '../../src/lib/resolve-render-bindings';

const marker = (expression: RenderBindingMarker['expression']): RenderBindingMarker => ({
  [RENDER_BINDING_MARKER]: true,
  expression,
});

function evaluated(expression: RenderBindingMarker['expression']): object {
  const out = resolveRenderBindingMarkers({ body: marker(expression) }, 'Tour', { flag: true }, undefined, 'idle');
  if (typeof out === 'string' || out.body === null || typeof out.body !== 'object') throw new Error('expected an object');
  return out.body;
}

describe('evaluated render nodes stay walkable for @trait refs', () => {
  it('a pattern node chosen by an if is not branded as data', () => {
    const node = evaluated(['if', '@entity.flag', { type: 'card', children: ['@trait.DemoBoardView'] }, { type: 'card', children: [] }]);
    expect(isEvaluatorResolvedData(node)).toBe(false);
  });

  it('a list of pattern nodes from array/map is not branded as data', () => {
    const nodes = evaluated(['array/map', ['quote', '[1,2]'], ['fn', 'n', { type: 'card', children: ['@trait.Row'] }]]);
    expect(isEvaluatorResolvedData(nodes)).toBe(false);
  });

  it('control: evaluated plain data stays branded', () => {
    const points = evaluated(['if', '@entity.flag', [{ x: 1, y: 2 }, { x: 3, y: 4 }], []]);
    expect(isEvaluatorResolvedData(points)).toBe(true);
  });

  it('control: data with an unregistered `type` field stays branded', () => {
    const tiles = evaluated(['if', '@entity.flag', [{ type: 'ground', x: 0 }], []]);
    expect(isEvaluatorResolvedData(tiles)).toBe(true);
  });
});
