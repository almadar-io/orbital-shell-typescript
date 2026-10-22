/**
 * G-CORE-022: payload synthesis through `let`, `if`, `array/some`,
 * `array/every` and `grid/in-bounds` guards, each with a paired control.
 */

import { describe, it, expect } from 'vitest';
import { buildGuardPayloads } from '../src/state-machine/guard-payloads.js';
import type { SExpr } from '../src/types/expression.js';

describe('let', () => {
  it('binds the value then recurses into the body', () => {
    const g: SExpr = ['let', [['n', '@payload.count']], ['>', '@n', 3]];
    expect(buildGuardPayloads(g)).toEqual({ pass: { count: 4 }, fail: { count: 2 } });
  });

  it('threads earlier bindings into later ones', () => {
    const g: SExpr = ['let', [['a', '@payload.row'], ['b', '@a.size']], ['>', '@b', 0]];
    expect(buildGuardPayloads(g)).toEqual({ pass: { row: { size: 1 } }, fail: { row: { size: -1 } } });
  });

  it('control: a let body with no payload refs stays empty', () => {
    expect(buildGuardPayloads(['let', [['n', 1]], ['>', '@n', 0]])).toEqual({ pass: {}, fail: {} });
  });
});

describe('if', () => {
  const g: SExpr = ['if', ['=', '@payload.mode', 'edit'], '@payload.row', ['not-nil', '@payload.id']];

  it('pass takes the then-arm: condition true plus then passes', () => {
    const { pass } = buildGuardPayloads(g);
    expect(pass.mode).toBe('edit');
    expect(pass.row).toBeTruthy();
  });

  it('fail takes the then-arm violation (condition true, then fails)', () => {
    const { fail } = buildGuardPayloads(g);
    expect(fail.mode).toBe('edit');
    expect(fail.row).toBeNull();
  });

  it('constant-true condition forces the then-arm only', () => {
    const r = buildGuardPayloads(['if', ['=', 'a', 'a'], ['not-nil', '@payload.x'], ['not-nil', '@payload.y']]);
    expect(r.pass).toEqual({ x: 'mock-test-value' });
    expect(r.fail).toEqual({ x: null });
  });

  it('constant-false condition forces the else-arm only', () => {
    const r = buildGuardPayloads(['if', ['=', 'a', 'b'], ['not-nil', '@payload.x'], ['not-nil', '@payload.y']]);
    expect(r.pass).toEqual({ y: 'mock-test-value' });
    expect(r.fail).toEqual({ y: null });
  });

  it('a then-arm that is constant false is skipped for pass (else-arm via condition false)', () => {
    const r = buildGuardPayloads(['if', ['=', '@payload.m', 'x'], false, ['not-nil', '@payload.y']]);
    expect(r.pass).toEqual({ m: 'not-x', y: 'mock-test-value' });
    expect(r.fail).toEqual({ m: 'x' });
  });

  it('missing else behaves as false', () => {
    const r = buildGuardPayloads(['if', ['=', '@payload.m', 'x'], ['not-nil', '@payload.y']]);
    expect(r.pass).toEqual({ m: 'x', y: 'mock-test-value' });
    expect(r.fail).toEqual({ m: 'x', y: null });
  });
});

describe('array/some and array/every over a payload list', () => {
  const pred: SExpr = ['fn', 'i', ['=', '@i.kind', 'ok']];

  it('some: true needs one satisfying element, false is an empty list', () => {
    const r = buildGuardPayloads(['array/some', '@payload.items', pred]);
    expect(r.pass).toEqual({ items: [{ kind: 'ok' }] });
    expect(r.fail).toEqual({ items: [] });
  });

  it('every: true is all satisfying, false needs one violating element', () => {
    const r = buildGuardPayloads(['array/every', '@payload.items', pred]);
    expect(r.pass).toEqual({ items: [{ kind: 'ok' }] });
    expect(r.fail).toEqual({ items: [{ kind: 'not-ok' }] });
  });

  it('object/get element access is treated like @i.field', () => {
    const r = buildGuardPayloads(['array/some', '@payload.items', ['fn', 'i', ['=', ['object/get', '@i', 'kind'], 'ok']]]);
    expect(r.pass).toEqual({ items: [{ kind: 'ok' }] });
  });

  it('nested collection path', () => {
    const r = buildGuardPayloads(['array/some', '@payload.data.rows', pred]);
    expect(r.pass).toEqual({ data: { rows: [{ kind: 'ok' }] } });
  });

  it('control: a predicate that never touches the element synthesizes no list', () => {
    const r = buildGuardPayloads(['array/some', '@payload.items', ['fn', 'i', ['=', '@entity.a', 1]]]);
    expect(r.pass).toEqual({});
  });

  it('control: a shadowing inner fn does not leak the outer element', () => {
    const r = buildGuardPayloads(['array/some', '@payload.items', ['fn', 'i', ['array/some', '@i.tags', ['fn', 'i', ['=', '@i.k', 1]]]]]);
    expect(r.pass).toEqual({ items: [{ tags: [{ k: 1 }] }] });
  });

  it('composes under not', () => {
    const r = buildGuardPayloads(['not', ['array/some', '@payload.items', pred]]);
    expect(r.pass).toEqual({ items: [] });
    expect(r.fail).toEqual({ items: [{ kind: 'ok' }] });
  });
});

describe('array/some and array/every over a literal collection', () => {
  const transitions = [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }];
  const pred: SExpr = ['fn', 't', ['and', ['=', ['object/get', '@t', 'from'], '@payload.from'], ['=', ['object/get', '@t', 'to'], '@payload.to']]];

  it('some pass: a payload matching the first element', () => {
    const r = buildGuardPayloads(['array/some', transitions, pred]);
    expect(r.pass).toEqual({ from: 'a', to: 'b' });
  });

  it('some fail: payload fields matching no element', () => {
    const r = buildGuardPayloads(['array/some', transitions, pred]);
    expect(r.fail.from).not.toBe('a');
    expect(r.fail.from).not.toBe('c');
  });

  it('every over literal: pass satisfies each element, fail violates one; a constant-true body has no arm', () => {
    const limits = [{ name: 'a', words: 5 }];
    const r = buildGuardPayloads(['array/every', limits, ['fn', 'l', ['<=', '@payload.n', '@l.words']]]);
    expect(r).toEqual({ pass: { n: 5 }, fail: { n: 6 } });
    expect(buildGuardPayloads(['array/every', limits, ['fn', 'l', ['=', '@l.words', 5]]])).toEqual({ pass: {}, fail: {} });
  });

  it('control: the std-agent-builder shape (entity-only predicate) synthesizes nothing and does not throw', () => {
    const g: SExpr = ['array/every', [{ name: 'a', words: 5 }], ['fn', 'l', ['<=', ['array/len', ['str/split', ['str/trim', ['object/get', '@entity.filledFields', '@l.name', '']], ' ']], '@l.words']]];
    expect(buildGuardPayloads(g)).toEqual({ pass: {}, fail: {} });
  });

  it('empty collection has no steerable arm', () => {
    expect(buildGuardPayloads(['array/some', [], pred])).toEqual({ pass: {}, fail: {} });
  });
});

describe('grid/in-bounds', () => {
  it('literal bounds: inside at the origin, outside at -1', () => {
    const r = buildGuardPayloads(['grid/in-bounds', { x: '@payload.x', y: '@payload.y' }, 8, 6]);
    expect(r.pass).toEqual({ x: 0, y: 0 });
    expect(r.fail.x).toBe(-1);
  });

  it('config (unresolved) bounds use coordinates valid for any positive grid', () => {
    const r = buildGuardPayloads(['grid/in-bounds', { x: '@payload.x', y: '@payload.z' }, '@config.gridWidth', '@config.gridHeight']);
    expect(r.pass).toEqual({ x: 0, z: 0 });
    expect(r.fail.x).toBe(-1);
  });

  it('only one steerable coordinate: pass and fail drive that one', () => {
    const r = buildGuardPayloads(['grid/in-bounds', { x: 1, y: '@payload.y' }, 4, 4]);
    expect(r.pass).toEqual({ y: 0 });
    expect(r.fail).toEqual({ y: -1 });
  });

  it('a payload position object', () => {
    const r = buildGuardPayloads(['grid/in-bounds', '@payload.pos', 3, 3]);
    expect(r.pass).toEqual({ pos: { x: 0, y: 0 } });
    expect(r.fail).toEqual({ pos: { x: -1, y: 0 } });
  });

  it('control: no payload-derived coordinate leaves both empty', () => {
    expect(buildGuardPayloads(['grid/in-bounds', { x: '@entity.x', y: 2 }, 4, 4])).toEqual({ pass: {}, fail: {} });
  });

  it('control: non-positive literal bounds have no in-bounds payload', () => {
    expect(buildGuardPayloads(['grid/in-bounds', { x: '@payload.x', y: '@payload.y' }, 0, 5]).pass).toEqual({});
  });

  it('composes inside and', () => {
    const r = buildGuardPayloads(['and', ['grid/in-bounds', { x: '@payload.x', y: '@payload.y' }, 5, 5], ['!=', '@payload.id', '']]);
    expect(r.pass).toMatchObject({ x: 0, y: 0 });
    expect(r.pass.id).toBe('not-');
  });
});
