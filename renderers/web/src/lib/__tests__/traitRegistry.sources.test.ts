import { afterEach, describe, expect, it } from 'vitest';
import { clearTraits, getAllTraits, getTrait, registerTraitSource, subscribeToTraitChanges, type TraitDebugInfo } from '../traitRegistry';

const info = (id: string, currentState: string): TraitDebugInfo => ({ id, name: id, currentState, states: ['idle'], transitions: [], guards: [], transitionCount: 0 });

afterEach(() => clearTraits());

describe('the trait debug registry reads each trait from its source when asked', () => {
  it('builds nothing at registration: the source runs only when a reader asks', () => {
    let built = 0;
    registerTraitSource('Feed', () => { built += 1; return info('Feed', 'idle'); });
    expect(built).toBe(0);
    expect(getAllTraits().map((t) => t.id)).toEqual(['Feed']);
    expect(built).toBe(1);
  });

  it('answers the state the source holds now, not the state at registration', () => {
    let state = 'idle';
    registerTraitSource('Feed', () => info('Feed', state));
    state = 'loading';
    expect(getTrait('Feed')?.currentState).toBe('loading');
  });

  it('control: unregistering removes the trait and tells subscribers', () => {
    let told = 0;
    const unsubscribe = subscribeToTraitChanges(() => { told += 1; });
    const unregister = registerTraitSource('Feed', () => info('Feed', 'idle'));
    unregister();
    unsubscribe();
    expect(getAllTraits()).toEqual([]);
    expect(told).toBe(2);
  });

  it('edge: a stale unregister leaves a newer source for the same trait in place', () => {
    const stale = registerTraitSource('Feed', () => info('Feed', 'old'));
    registerTraitSource('Feed', () => info('Feed', 'new'));
    stale();
    expect(getTrait('Feed')?.currentState).toBe('new');
  });
});
