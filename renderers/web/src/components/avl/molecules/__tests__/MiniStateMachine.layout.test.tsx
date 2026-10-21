import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MiniStateMachine } from '../MiniStateMachine';
import type { TraitLevelData } from '../../../../lib/avl-schema-parser';

const fx = (type: string) => ({ type, args: [] });

function trait(states: TraitLevelData['states'], effects: string[]): TraitLevelData {
  return {
    name: 'T',
    linkedEntity: 'E',
    states,
    transitions: [{ from: states[0].name, to: states[states.length - 1].name, event: 'GO', guard: null, effects: effects.map(fx), index: 0 }],
    emittedEvents: [],
    listenedEvents: [],
  };
}

interface Box { left: number; top: number; right: number; bottom: number }

function geometry(data: TraitLevelData) {
  const { container } = render(<MiniStateMachine data={data} />);
  const svg = container.querySelector('svg') as SVGSVGElement;
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  const stateBoxes: Box[] = [];
  const markers: Box[] = [];
  for (const g of svg.querySelectorAll('g[transform^="translate"]')) {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform') ?? '');
    if (!m) continue;
    const [tx, ty] = [Number(m[1]), Number(m[2])];
    for (const r of g.querySelectorAll(':scope > rect')) {
      const x = tx + Number(r.getAttribute('x')); const y = ty + Number(r.getAttribute('y'));
      stateBoxes.push({ left: x, top: y, right: x + Number(r.getAttribute('width')), bottom: y + Number(r.getAttribute('height')) });
    }
    for (const c of g.querySelectorAll(':scope > circle')) {
      const cx = tx + Number(c.getAttribute('cx')); const cy = ty + Number(c.getAttribute('cy')); const r = Number(c.getAttribute('r'));
      markers.push({ left: cx - r, top: cy - r, right: cx + r, bottom: cy + r });
    }
  }
  const effects: Box[] = [...svg.querySelectorAll('[data-testid="mini-sm-effect"]')].map((g) => {
    const c = g.querySelector('circle') as SVGCircleElement;
    const cx = Number(c.getAttribute('cx')); const cy = Number(c.getAttribute('cy')); const r = Number(c.getAttribute('r'));
    return { left: cx - r, top: cy - r, right: cx + r, bottom: cy + r };
  });
  return { width, height, stateBoxes, markers, effects };
}

const inside = (b: Box, w: number, h: number) => b.left >= 0 && b.top >= 0 && b.right <= w && b.bottom <= h;
const overlap = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe('MiniStateMachine layout', () => {
  it('effect icons sit apart from each other and below the state row', () => {
    const g = geometry(trait([{ name: 'a', isInitial: true, isTerminal: false }, { name: 'b', isInitial: false, isTerminal: true }], ['set', 'persist', 'emit', 'render-ui']));
    expect(g.effects).toHaveLength(4);
    for (let i = 1; i < g.effects.length; i++) expect(overlap(g.effects[i - 1], g.effects[i])).toBe(false);
    const rowBottom = Math.max(...g.stateBoxes.map((s) => s.bottom));
    for (const e of g.effects) expect(e.top).toBeGreaterThanOrEqual(rowBottom);
  });

  it('the initial marker, terminal border and every icon stay inside the svg', () => {
    const g = geometry(trait([{ name: 'a', isInitial: true, isTerminal: false }, { name: 'b', isInitial: false, isTerminal: true }], ['set', 'persist', 'emit']));
    for (const b of [...g.stateBoxes, ...g.markers, ...g.effects]) expect(inside(b, g.width, g.height)).toBe(true);
  });

  it('control: the initial marker does not overlap its state', () => {
    const g = geometry(trait([{ name: 'a', isInitial: true, isTerminal: false }], []));
    expect(g.markers).toHaveLength(1);
    for (const s of g.stateBoxes) expect(overlap(g.markers[0], s)).toBe(false);
  });

  it('edge: a wide effect row widens the svg past a single state', () => {
    const g = geometry(trait([{ name: 'only', isInitial: true, isTerminal: false }], ['set', 'persist', 'emit', 'render-ui', 'navigate', 'notify']));
    expect(g.effects).toHaveLength(6);
    for (const e of g.effects) expect(inside(e, g.width, g.height)).toBe(true);
  });

  it('edge: no effects means no effect row', () => {
    const g = geometry(trait([{ name: 'a', isInitial: false, isTerminal: false }, { name: 'b', isInitial: false, isTerminal: false }], []));
    expect(g.effects).toHaveLength(0);
    for (const b of g.stateBoxes) expect(inside(b, g.width, g.height)).toBe(true);
  });
});
