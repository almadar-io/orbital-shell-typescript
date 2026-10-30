/**
 * A host dispatch reaches this view when its response carries any trait the view owns, not only
 * when its target is here: an async result of a page-less orbital (a generator) fans out to a
 * page trait, and that trait's state, row and render ride on the same response.
 */
import { describe, it, expect } from 'vitest';
import type { EventRequest, EventResponse } from '@almadar/core';
import { hostDispatchInView } from '../hostDispatchInView';

const owned = new Set(['PageBuilder', 'PageTopBar']);
const owns = (trait: string): boolean => owned.has(trait);
const ownsFrame = (frame: string): boolean => owned.has(frame);
const writes = (frame: string): EventResponse['frames'] => ({ from: 0, to: 0, ops: [['set', { [frame]: { id: '1' } }]] });

const response = (over: Partial<EventResponse>): EventResponse => ({ success: true, transitioned: true, states: {}, emittedEvents: [], ...over });
const request = (targetTrait?: string): EventRequest => ({ event: 'ANSWERED', ...(targetTrait !== undefined ? { targetTrait } : {}) });

describe('hostDispatchInView', () => {
  it('a target this view owns is in view', () => {
    expect(hostDispatchInView(request('PageBuilder'), response({}), owns, ownsFrame)).toBe(true);
  });

  it('an off-view target whose fanout settled an owned trait is in view', () => {
    expect(hostDispatchInView(request('GeneratorTools'), response({ states: { GeneratorTools: 'idle', PageBuilder: 'idle' } }), owns, ownsFrame)).toBe(true);
  });

  it('an off-view target whose fanout painted an owned trait is in view', () => {
    expect(hostDispatchInView(request('GeneratorTools'), response({ clientEffectsByTrait: [{ traitName: 'PageTopBar', effect: ['render-ui', 'main', null] }] }), owns, ownsFrame)).toBe(true);
  });

  it('an off-view target whose fanout wrote an owned frame is in view', () => {
    expect(hostDispatchInView(request('GeneratorTools'), response({ frames: writes('PageBuilder') }), owns, ownsFrame)).toBe(true);
  });

  it('an off-view target whose only owned write is an id is in view', () => {
    expect(hostDispatchInView(request('GeneratorTools'), response({ frames: writes('PageBuilder') }), owns, ownsFrame)).toBe(true);
  });

  it('control: an off-view target with no row, state or paint for an owned trait is not in view', () => {
    expect(hostDispatchInView(request('GeneratorTools'), response({ frames: { from: 0, to: 0, ops: [] } }), owns, ownsFrame)).toBe(false);
  });

  it('control: an off-view target touching only off-view traits is not in view', () => {
    expect(hostDispatchInView(request('GeneratorTools'), response({ states: { GeneratorTools: 'idle', OtherPage: 'idle' }, frames: writes('OtherPage') }), owns, ownsFrame)).toBe(false);
  });

  it('control: no target and no owned trait is not in view', () => {
    expect(hostDispatchInView(request(), response({}), owns, ownsFrame)).toBe(false);
  });
});
