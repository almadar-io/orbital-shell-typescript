/**
 * A host dispatch reaches this view when its response carries any trait the view owns, not only
 * when its target is here: an async result of a page-less orbital (a generator) fans out to a
 * page trait, and that trait's state, row and render ride on the same response.
 */
import { describe, it, expect } from 'vitest';
import type { OrbitalEventRequest, OrbitalEventResponse } from '@almadar/core';
import { hostDispatchInView } from '../hostDispatchInView';

const owned = new Set(['PageBuilder', 'PageTopBar']);
const owns = (trait: string): boolean => owned.has(trait);

const response = (over: Partial<OrbitalEventResponse>): OrbitalEventResponse => ({ success: true, transitioned: true, states: {}, emittedEvents: [], ...over });
const request = (targetTrait?: string): OrbitalEventRequest => ({ event: 'ANSWERED', ...(targetTrait !== undefined ? { targetTrait } : {}) });

describe('hostDispatchInView', () => {
  it('a target this view owns is in view', () => {
    expect(hostDispatchInView(request('PageBuilder'), response({}), owns)).toBe(true);
  });

  it('an off-view target whose fanout settled an owned trait is in view', () => {
    expect(hostDispatchInView(request('GeneratorTools'), response({ states: { GeneratorTools: 'idle', PageBuilder: 'idle' } }), owns)).toBe(true);
  });

  it('an off-view target whose fanout painted an owned trait is in view', () => {
    expect(hostDispatchInView(request('GeneratorTools'), response({ clientEffectsByTrait: [{ traitName: 'PageTopBar', effect: ['render-ui', 'main', null] }] }), owns)).toBe(true);
  });

  it('an off-view target whose fanout wrote an owned trait row is in view', () => {
    expect(hostDispatchInView(request('GeneratorTools'), response({ entityByTrait: { PageBuilder: { id: '1' } } }), owns)).toBe(true);
  });

  it('control: an off-view target touching only off-view traits is not in view', () => {
    expect(hostDispatchInView(request('GeneratorTools'), response({ states: { GeneratorTools: 'idle', OtherPage: 'idle' }, entityByTrait: { OtherPage: { id: '1' } } }), owns)).toBe(false);
  });

  it('control: no target and no owned trait is not in view', () => {
    expect(hostDispatchInView(request(), response({}), owns)).toBe(false);
  });
});
