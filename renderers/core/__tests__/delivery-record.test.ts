// `@event`'s value: the delivery record with `source` exposing BusEventSource 1:1 (owner ruling D2, 2026-09-24).
import { describe, it, expect } from 'vitest';
import { OrbitalEventRequestSchema, deliveryRecordValue, type BusEventSource } from '../src/types/bus.js';
import type { OrbitalId, TraitId, EventId } from '../src/types/identity.js';

const full: BusEventSource = {
  orbital: 'Main',
  orbitalId: 'orb_main' as OrbitalId,
  trait: 'Search',
  traitId: 'tr_search' as TraitId,
  eventId: 'ev_x' as EventId,
  transition: 'idle->searching',
  tick: 'heartbeat',
  fromBridge: true,
  dispatched: false,
  originClientId: 'tab-a',
};

describe('deliveryRecordValue', () => {
  it('carries every one of the ten source fields, and nothing else', () => {
    const value = deliveryRecordValue({ event: 'X', payload: { n: 1 }, source: full });
    expect(value).toEqual({ event: 'X', payload: { n: 1 }, source: { ...full } });
    expect(Object.keys(value.source ?? {}).sort()).toEqual(
      ['dispatched', 'eventId', 'fromBridge', 'orbital', 'orbitalId', 'originClientId', 'tick', 'trait', 'traitId', 'transition'],
    );
  });

  it('omits unset source fields and keeps a false flag', () => {
    const value = deliveryRecordValue({ event: 'X', source: { trait: 'Search', dispatched: false } });
    expect(value.source).toEqual({ trait: 'Search', dispatched: false });
  });

  it('a delivery without a payload reads as null', () => {
    expect(deliveryRecordValue({ event: 'SEED', source: {} })).toEqual({ event: 'SEED', payload: null, source: {} });
  });
});

describe('the request carries a client-begun dispatch', () => {
  it('accepts delivery + dispatchLog and keeps them', () => {
    const request = {
      event: 'GOT',
      targetTrait: 'Once',
      delivery: { event: 'X', payload: { n: 2 }, source: { orbital: 'Main', trait: 'Src' } },
      dispatchLog: { prevEvents: [{ event: 'X', payload: { n: 1 }, source: { trait: 'Src' } }], prevStates: ['idle'] },
    };
    expect(OrbitalEventRequestSchema.parse(request)).toEqual(request);
  });

  it('rejects a delivery without an event name or a log entry without a source', () => {
    expect(OrbitalEventRequestSchema.safeParse({ event: 'GOT', delivery: { source: {} } }).success).toBe(false);
    expect(OrbitalEventRequestSchema.safeParse({
      event: 'GOT', dispatchLog: { prevEvents: [{ event: 'X' }], prevStates: [] },
    }).success).toBe(false);
  });

  it('a request without them is still valid (a direct dispatch)', () => {
    expect(OrbitalEventRequestSchema.safeParse({ event: 'GO' }).success).toBe(true);
  });
});
