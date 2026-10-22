import { describe, it, expect } from 'vitest';
import { compareTraces, applyClockFields, applyMintedIds, unmetExpectations } from '../src/trace.js';
import type { Trace, TraceStep } from '../src/types.js';

const step = (over: Partial<TraceStep> = {}): TraceStep => ({
  trait: 'Src',
  event: 'GO',
  states: { Src: 'idle' },
  effects: [],
  emits: [{ event: 'X', payload: { n: 1 } }],
  ...over,
});
const trace = (...steps: TraceStep[]): Trace => ({ steps });

describe('compareTraces', () => {
  it('equal traces have no difference, key order and integral floats are canonical', () => {
    const a = trace(step({ emits: [{ event: 'X', payload: { b: 1, a: 2 } }] }));
    const b = trace(step({ emits: [{ event: 'X', payload: { a: 2, b: 1.0 } }] }));
    expect(compareTraces(a, b)).toBeNull();
  });

  it('reports the first differing step and field', () => {
    const ref = trace(step(), step({ states: { Src: 'idle', Sink: 'done' } }));
    const got = trace(step(), step({ states: { Src: 'idle', Sink: 'waiting' } }));
    const diff = compareTraces(ref, got);
    expect(diff?.stepIndex).toBe(1);
    expect(diff?.field).toBe('states');
    expect(diff?.expected).toEqual({ Src: 'idle', Sink: 'done' });
    expect(diff?.actual).toEqual({ Src: 'idle', Sink: 'waiting' });
  });

  it('distinguishes emits order and effects', () => {
    const two = [{ event: 'X', payload: { n: 1 } }, { event: 'X', payload: { n: 2 } }];
    const swapped = [two[1], two[0]];
    expect(compareTraces(trace(step({ emits: two })), trace(step({ emits: swapped })))?.field).toBe('emits');
    expect(compareTraces(trace(step()), trace(step({ effects: [['render-ui', 'main']] })))?.field).toBe('effects');
  });

  it('a missing step is a length difference at the first absent index', () => {
    const diff = compareTraces(trace(step(), step()), trace(step()));
    expect(diff?.stepIndex).toBe(1);
    expect(diff?.field).toBe('length');
  });
});

describe('applyClockFields', () => {
  it('replaces a declared numeric clock field by a marker, leaves others and non-numbers', () => {
    const t = trace(step({ emits: [{ event: 'Stamped', payload: { at: 17, keep: 3 } }, { event: 'Stamped', payload: { at: 'x' } }] }));
    const out = applyClockFields(t, ['Stamped.at']);
    expect(out.steps[0].emits[0].payload).toEqual({ at: '<clock>', keep: 3 });
    expect(out.steps[0].emits[1].payload).toEqual({ at: 'x' });
    expect(applyClockFields(t, []).steps[0].emits[0].payload).toEqual({ at: 17, keep: 3 });
  });
});

describe('applyClockFields over rows', () => {
  const rows = (stamp: string) => ({ data: [{ id: 'a', createdAt: stamp }, { id: 'b', createdAt: stamp }], totalCount: 2 });

  it('masks an ISO timestamp string at a path through an array of rows', () => {
    const t = trace(step({ emits: [{ event: 'Loaded', payload: rows('2026-10-13T08:30:00.000Z') }] }));
    const out = applyClockFields(t, ['Loaded.data.*.createdAt']);
    expect(out.steps[0].emits[0].payload).toEqual({ data: [{ id: 'a', createdAt: '<clock>' }, { id: 'b', createdAt: '<clock>' }], totalCount: 2 });
  });

  it('two traces that differ only in the stamped instant compare equal', () => {
    const left = trace(step({ emits: [{ event: 'Loaded', payload: rows('2026-10-13T08:30:00.000Z') }] }));
    const right = trace(step({ emits: [{ event: 'Loaded', payload: rows('2026-10-13T09:45:10.123Z') }] }));
    const fields = ['Loaded.data.*.createdAt'];
    expect(compareTraces(applyClockFields(left, fields), applyClockFields(right, fields))).toBeNull();
  });

  it('control: a non-timestamp string at the path is not masked, so a difference still shows', () => {
    const left = trace(step({ emits: [{ event: 'Loaded', payload: rows('soon') }] }));
    const right = trace(step({ emits: [{ event: 'Loaded', payload: rows('later') }] }));
    const fields = ['Loaded.data.*.createdAt'];
    expect(compareTraces(applyClockFields(left, fields), applyClockFields(right, fields))?.field).toBe('emits');
  });

  it('control: an undeclared timestamp still differs', () => {
    const left = trace(step({ emits: [{ event: 'Loaded', payload: rows('2026-10-13T08:30:00.000Z') }] }));
    const right = trace(step({ emits: [{ event: 'Loaded', payload: rows('2026-10-13T09:45:10.123Z') }] }));
    expect(compareTraces(applyClockFields(left, []), applyClockFields(right, []))?.field).toBe('emits');
  });
});

describe('unmetExpectations with clock fields', () => {
  const stamped = step({ emits: [{ event: 'Loaded', payload: { data: [{ id: 'a', createdAt: '2026-10-13T08:30:00.000Z' }] } }] });
  const expectation = { emits: [{ event: 'Loaded', payload: { data: [{ id: 'a', createdAt: '<clock>' }] } }] };

  it('an expectation written with the marker is met by a declared clock field', () => {
    expect(unmetExpectations(stamped, expectation, ['Loaded.data.*.createdAt'])).toEqual([]);
  });

  it('control: without the declaration the marker is a literal and the step misses', () => {
    expect(unmetExpectations(stamped, expectation)).toHaveLength(1);
  });
});

describe('unmetExpectations', () => {
  it('names states and emits a step misses, none when met', () => {
    const s = step({ states: { Src: 'idle', Sink: 'done' } });
    expect(unmetExpectations(s, { states: { Sink: 'done' } })).toEqual([]);
    expect(unmetExpectations(s, { states: { Sink: 'waiting' } })).toEqual(['Sink=done (want waiting)']);
    expect(unmetExpectations(s, { emits: [{ event: 'X', payload: { n: 2 } }] })[0]).toMatch(/^emits /);
    expect(unmetExpectations(s, undefined)).toEqual([]);
  });
});

describe('applyMintedIds', () => {
  const logged = (id: string, actor = 'viewer-1'): Trace => trace(step({ emits: [{ event: 'Logged', payload: { id, actor } }] }));

  it('a minted id compares as "a minted id": two stores that format it differently are equal', () => {
    expect(compareTraces(applyMintedIds(logged('ReviewEvent-1'), ['Logged.id']), applyMintedIds(logged('id-0'), ['Logged.id']))).toBeNull();
  });

  it('control: another field of the same payload still differs, and so does an unmasked id', () => {
    const masked = (t: Trace) => applyMintedIds(t, ['Logged.id']);
    expect(compareTraces(masked(logged('a')), masked(logged('b', 'someone-else')))?.field).toBe('emits');
    expect(compareTraces(logged('ReviewEvent-1'), logged('id-0'))?.field).toBe('emits');
  });

  it('a missing id is not masked into existence', () => {
    const none = trace(step({ emits: [{ event: 'Logged', payload: { actor: 'viewer-1' } }] }));
    expect(compareTraces(applyMintedIds(none, ['Logged.id']), applyMintedIds(logged('x'), ['Logged.id']))?.field).toBe('emits');
  });
});

describe('effect tuples', () => {
  const effect = (...tuple: Array<string | number | object | null>): Trace => trace(step({ effects: [tuple as never] }));

  it('trailing null placeholders are not part of an effect: the JS interpreter pads, the kernel does not', () => {
    expect(compareTraces(effect('render-ui', 'main', { type: 'x' }), effect('render-ui', 'main', { type: 'x' }, null, null))).toBeNull();
  });

  it('control: a non-null element, or a null in the middle, still differs', () => {
    expect(compareTraces(effect('render-ui', 'main', { type: 'x' }), effect('render-ui', 'main', { type: 'x' }, 5))?.field).toBe('effects');
    expect(compareTraces(effect('a', null, 'b'), effect('a', 'b'))?.field).toBe('effects');
  });
});
