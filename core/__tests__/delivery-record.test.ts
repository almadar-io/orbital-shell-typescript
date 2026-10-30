// The request carries a client-begun dispatch (delivery + dispatchLog).
import { describe, it, expect } from 'vitest';
import { decodeEventRequest, isEventRequest } from '../src/generated/kernel-wire.js';

describe('the request carries a client-begun dispatch', () => {
  it('accepts delivery + dispatchLog and keeps them', () => {
    const request = {
      event: 'GOT',
      targetTrait: 'Once',
      delivery: { event: 'X', payload: { n: 2 }, source: { orbital: 'Main', trait: 'Src' } },
      dispatchLog: { prevEvents: [{ event: 'X', payload: { n: 1 }, source: { trait: 'Src' } }], prevStates: ['idle'] },
    };
    expect(decodeEventRequest(request)).toEqual(request);
  });

  it('rejects a delivery without an event name or a log entry without a source', () => {
    expect(isEventRequest({ event: 'GOT', delivery: { source: {} } })).toBe(false);
    expect(isEventRequest({
      event: 'GOT', dispatchLog: { prevEvents: [{ event: 'X' }], prevStates: [] },
    })).toBe(false);
  });

  it('a request without them is still valid (a direct dispatch)', () => {
    expect(isEventRequest({ event: 'GO' })).toBe(true);
  });
});
