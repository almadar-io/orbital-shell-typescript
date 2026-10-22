// `DispatchVisits` answers exactly what a `dispatchVisitKey` set answers, without serializing every frame.
import { describe, it, expect } from 'vitest';
import type { EventPayload, EventPayloadValue } from '../src/types/expression.js';
import { DispatchVisits, dispatchVisitKey } from '../src/types/visit-key.js';

const VALUES: EventPayloadValue[] = [
  null, undefined, 0, -0, 1, 1.0, 1.5, NaN, Infinity, '', 'null', '0', '1970-01-01T00:00:00.000Z',
  true, false, new Date(0), new Date(1), [], [null], [undefined], [1, 2], [2, 1], {}, { a: undefined },
  { a: 1 }, { a: 1, b: undefined }, { b: 2, a: 1 }, { a: 1, b: 2 }, { a: [1, { c: 2 }] }, { a: [1, { c: 3 }] },
  { a: { b: null } }, { a: { b: undefined } }, { a: { b: new Date(0) } }, { a: { b: '1970-01-01T00:00:00.000Z' } },
];
const FRAMES: (EventPayload | null)[] = [null, {}, { n: 1 }, { n: 1, x: undefined }, { x: undefined, n: 1.0 }, { n: 2 }, { rows: [{ id: 'a' }] }];

describe('DispatchVisits', () => {
  it('agrees with dispatchVisitKey on every payload pair', () => {
    for (const a of VALUES) {
      for (const b of VALUES) {
        const pa = { v: a };
        const pb = { v: b };
        const visits = new DispatchVisits();
        visits.add('T', 'E', 's', pa, null);
        expect(visits.has('T', 'E', 's', pb, null), `${String(a)} vs ${String(b)}`)
          .toBe(dispatchVisitKey('T', 'E', 's', pa, null) === dispatchVisitKey('T', 'E', 's', pb, null));
      }
    }
  });

  it('agrees with dispatchVisitKey on every frame pair, including no frame', () => {
    for (const a of FRAMES) {
      for (const b of FRAMES) {
        const visits = new DispatchVisits();
        visits.add('T', 'E', 's', undefined, a);
        expect(visits.has('T', 'E', 's', null, b))
          .toBe(dispatchVisitKey('T', 'E', 's', undefined, a) === dispatchVisitKey('T', 'E', 's', null, b));
      }
    }
  });

  it('each of trait, event and from is part of the identity', () => {
    const visits = new DispatchVisits();
    visits.add('T', 'E', 's', null, null);
    expect(visits.has('U', 'E', 's', null, null)).toBe(false);
    expect(visits.has('T', 'F', 's', null, null)).toBe(false);
    expect(visits.has('T', 'E', 't', null, null)).toBe(false);
    expect(visits.has('a\u0000b', 'c', 's', null, null)).toBe(false);
  });

  it('control: the identical step is a repeat', () => {
    const visits = new DispatchVisits();
    visits.add('T', 'E', 's', { k: 1 }, { n: 1 });
    expect(visits.has('T', 'E', 's', { k: 1 }, { n: 1 })).toBe(true);
  });

  it('remembers every distinct frame seen for one step', () => {
    const visits = new DispatchVisits();
    visits.add('T', 'E', 's', null, { n: 1 });
    visits.add('T', 'E', 's', null, { n: 2 });
    expect(visits.has('T', 'E', 's', null, { n: 1 })).toBe(true);
    expect(visits.has('T', 'E', 's', null, { n: 2 })).toBe(true);
    expect(visits.has('T', 'E', 's', null, { n: 3 })).toBe(false);
  });

  it('keeps the frame as it stood when recorded, though a step reassigns its fields afterwards', () => {
    const frame: EventPayload = { n: 1 };
    const visits = new DispatchVisits();
    visits.add('T', 'E', 's', null, frame);
    frame.n = 2;
    expect(visits.has('T', 'E', 's', null, { n: 2 })).toBe(false);
    expect(visits.has('T', 'E', 's', null, { n: 1 })).toBe(true);
  });

  it('never walks into a frame whose trait, event and from state were not visited before', () => {
    let reads = 0;
    const rows = new Proxy<EventPayload>({ a: [1, 2, 3] }, {
      ownKeys(target) { reads += 1; return Reflect.ownKeys(target); },
      get(target, key) { reads += 1; return Reflect.get(target, key); },
    });
    const frame: EventPayload = { rows };
    const visits = new DispatchVisits();
    visits.add('T', 'A', 's', null, frame);
    expect(visits.has('T', 'B', 's', null, frame)).toBe(false);
    visits.add('T', 'B', 's', null, frame);
    expect(reads).toBe(0);
  });
});
