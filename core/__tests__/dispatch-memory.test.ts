// The shared dispatch memory: what each trait has received and left, per dispatch.
import { describe, it, expect } from 'vitest';
import { DispatchMemory, dispatchScopeOf } from '../src/types/dispatch-memory.js';

const x = (n: number) => ({ event: 'X', payload: { n }, source: { trait: 'Src' } });

describe('DispatchMemory', () => {
  it('a view never includes the delivery being processed', () => {
    const m = new DispatchMemory();
    expect(m.view('L', x(1)).prevEvents).toEqual([]);
    m.recordDelivery('L', x(1));
    expect(m.view('L', x(2)).prevEvents).toEqual([{ event: 'X', payload: { n: 1 }, source: { trait: 'Src' } }]);
    expect(m.view('L', x(2)).event).toEqual({ event: 'X', payload: { n: 2 }, source: { trait: 'Src' } });
  });

  it('keeps each trait separate', () => {
    const m = new DispatchMemory();
    m.recordDelivery('A', x(1));
    expect(m.view('B', x(1)).prevEvents).toEqual([]);
  });

  it('records a state only when the trait leaves it', () => {
    const m = new DispatchMemory();
    m.recordTransition('T', 'idle', 'idle');
    m.recordTransition('T', 'idle', 'busy');
    m.recordTransition('T', 'busy', 'idle');
    expect(m.log('T').prevStates).toEqual(['idle', 'busy']);
  });

  it('a seeded log round-trips as the wire log', () => {
    const m = new DispatchMemory();
    m.seed('T', { prevEvents: [x(4)], prevStates: ['idle'] });
    expect(m.log('T')).toEqual({ prevEvents: [x(4)], prevStates: ['idle'] });
    expect(m.view('T', x(5)).prevEvents).toHaveLength(1);
  });

  it('the log handed out is a copy', () => {
    const m = new DispatchMemory();
    m.recordDelivery('T', x(1));
    m.log('T').prevEvents.push(x(9));
    expect(m.log('T').prevEvents).toHaveLength(1);
  });
});

describe('dispatchScopeOf', () => {
  it('no delivery is a direct dispatch with an empty source and empty logs', () => {
    expect(dispatchScopeOf(undefined, undefined, 'GO', { a: 1 })).toEqual({
      event: { event: 'GO', payload: { a: 1 }, source: {} }, prevEvents: [], prevStates: [],
    });
  });
});
