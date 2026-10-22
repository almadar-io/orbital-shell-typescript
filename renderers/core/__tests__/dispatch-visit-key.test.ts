// Twin of orbital-core `util/visit_key.rs` tests: identical cases, identical verdicts.
import { describe, it, expect } from 'vitest';
import type { EventPayload } from '../src/types/expression.js';
import { dispatchVisitKey } from '../src/types/visit-key.js';

const key = (p: EventPayload | null | undefined): string => dispatchVisitKey('Search', 'STEP', 'searching', p, null);

describe('dispatchVisitKey', () => {
  it('object key order does not change the key', () => {
    expect(key({ a: 1, b: { c: 2, d: 3 } })).toBe(key({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('array order does change the key', () => {
    expect(key({ ids: [1, 2] })).not.toBe(key({ ids: [2, 1] }));
  });

  it('an integral float is the same number as the integer', () => {
    expect(key({ remaining: 1.0 })).toBe(key({ remaining: 1 }));
    expect(key({ remaining: 1.5 })).not.toBe(key({ remaining: 1 }));
  });

  it('different payloads are different deliveries', () => {
    expect(key({ remaining: 2 })).not.toBe(key({ remaining: 1 }));
    expect(key(null)).not.toBe(key({}));
  });

  it('each component is part of the identity', () => {
    const base = dispatchVisitKey('T', 'E', 's', null, null);
    expect(dispatchVisitKey('U', 'E', 's', null, null)).not.toBe(base);
    expect(dispatchVisitKey('T', 'F', 's', null, null)).not.toBe(base);
    expect(dispatchVisitKey('T', 'E', 't', null, null)).not.toBe(base);
  });

  it('a colon in a name cannot collide across components', () => {
    expect(dispatchVisitKey('a:b', 'c', 's', null, null)).not.toBe(dispatchVisitKey('a', 'b:c', 's', null, null));
  });

  it('a missing payload, a null payload and an undefined field are all the same absence', () => {
    expect(key(undefined)).toBe(key(null));
    expect(key({ a: 1, b: undefined })).toBe(key({ a: 1 }));
  });

  it('a date keys by its instant', () => {
    expect(key({ at: new Date(0) })).toBe(key({ at: new Date(0) }));
    expect(key({ at: new Date(0) })).not.toBe(key({ at: new Date(1) }));
  });
});

describe('dispatchVisitKey: the trait frame is part of the identity (G-CROSS-057)', () => {
  it('the same step against a different frame is a different delivery', () => {
    expect(dispatchVisitKey('Judge', 'SAVED', 'saving', { totalCount: 12 }, { batch: 'a' }))
      .not.toBe(dispatchVisitKey('Judge', 'SAVED', 'saving', { totalCount: 12 }, { batch: 'b' }));
  });

  it('control: the same step against the same frame is the same delivery (a true cycle)', () => {
    expect(dispatchVisitKey('Judge', 'SAVED', 'saving', { totalCount: 12 }, { batch: 'a', n: 1 }))
      .toBe(dispatchVisitKey('Judge', 'SAVED', 'saving', { totalCount: 12 }, { n: 1, batch: 'a' }));
  });

  it('edge: no frame and an empty frame are different identities', () => {
    expect(dispatchVisitKey('T', 'E', 's', {}, null)).not.toBe(dispatchVisitKey('T', 'E', 's', {}, {}));
  });
});
