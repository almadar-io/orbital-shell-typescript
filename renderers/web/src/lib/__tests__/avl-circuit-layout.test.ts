import { describe, it, expect } from 'vitest';
import type { SExpr } from '@almadar/core';
import { traced } from '../../../test/ui/helpers/traced';
import { buildCircuit, circuitState, type CircuitNode } from '../avl-circuit-layout';

const GUARD: SExpr = ['and', ['>', '@entity.qty', 0], ['=', '@user.role', 'admin']];
const find = (root: CircuitNode, key: string): CircuitNode => {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.key === key) return n;
    stack.push(...n.children);
  }
  throw new Error(`no node ${key}`);
};
const within = (inner: CircuitNode, outer: { w: number; h: number }) =>
  inner.x >= 0 && inner.y >= 0 && inner.x + inner.w <= outer.w && inner.y + inner.h <= outer.h;

describe('buildCircuit — the notation for any S-expression', () => {
  it('draws each call with its declared circuit form, leaves as sources and constants', () => {
    const c = buildCircuit(GUARD);
    expect(c.root.form).toBe('series');
    expect(find(c.root, '1').form).toBe('block');
    expect(find(c.root, '1.1').kind).toBe('binding');
    expect(find(c.root, '1.2').kind).toBe('literal');
    expect(buildCircuit(['or', true, false]).root.form).toBe('parallel');
    expect(buildCircuit(['if', true, 1, 2]).root.form).toBe('branch');
    expect(buildCircuit(['array/map', ['list', 1], ['fn', 'x', '@x']]).root.form).toBe('conveyor');
    expect(buildCircuit(['set', '@entity.status', 'saving']).root.form).toBe('actuator');
  });

  it('reads right to left: the root is rightmost, every child left of its parent, all inside the board', () => {
    const c = buildCircuit(GUARD);
    const walk = (n: CircuitNode) => {
      expect(within(n, c), n.key).toBe(true);
      for (const ch of n.children) {
        expect(ch.x + ch.w, `${ch.key} left of ${n.key}`).toBeLessThanOrEqual(n.x);
        walk(ch);
      }
    };
    walk(c.root);
  });

  it('gives sibling subtrees disjoint vertical bands (no overlap)', () => {
    const c = buildCircuit(['+', ['*', 1, 2], ['*', 3, ['-', 5, 4]], 6]);
    const kids = c.root.children;
    for (let i = 1; i < kids.length; i++) expect(kids[i].bandTop).toBeGreaterThanOrEqual(kids[i - 1].bandBottom);
  });

  it('control: an unregistered head is drawn as an unknown block, not guessed', () => {
    expect(buildCircuit(['made-up', 1]).root.form).toBe('unknown');
  });
});

describe('circuitState — what the trace says at the cursor', () => {
  const { trace } = traced(GUARD, { entity: { qty: 3 }, user: { id: 'u1', role: 'viewer' }, state: 'idle' });

  it('at the end: every evaluated node is done with its value; the failed comparison is false', () => {
    const s = circuitState(trace, trace.length - 1);
    expect(s.get('1')).toMatchObject({ status: 'done', value: true });
    expect(s.get('2')).toMatchObject({ status: 'done', value: false });
    expect(s.get('')).toMatchObject({ status: 'done', value: false });
  });

  it('mid-run: the node entered but not exited is active', () => {
    const firstEnterOf2 = trace.findIndex((t) => t.kind === 'enter' && t.path.join('.') === '2');
    const s = circuitState(trace, firstEnterOf2);
    expect(s.get('2')?.status).toBe('active');
    expect(s.get('')?.status).toBe('active');
    expect(s.get('1')?.status).toBe('done');
  });

  it('marks short-circuited arguments skipped', () => {
    const { trace: t } = traced(['and', ['>', 0, 1], ['=', 1, 1]]);
    expect(circuitState(t, t.length - 1).get('2')?.status).toBe('skipped');
  });

  it('counts lambda iterations and keeps each item result in order', () => {
    const { trace: t } = traced(['array/map', ['list', 1, 2, 3], ['fn', 'x', ['*', '@x', 2]]]);
    const body = circuitState(t, t.length - 1).get('2.2');
    expect(body?.results).toEqual([2, 4, 6]);
  });

  it('control: before any step nothing is running', () => {
    expect([...circuitState(trace, -1).values()].every((n) => n.status === 'idle')).toBe(true);
  });
});
