// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { BusEvent } from '@almadar/core';
import { bindEventBus, verifierAttached } from '../verificationRegistry';
import { createCircuitVerificationObserver } from '../circuitVerificationObserver';

afterEach(() => { delete window.__orbitalVerification; });

describe('verification event provenance', () => {
  it('preserves distinct machine sources when fetch events share a bare key', () => {
    let receive: ((event: BusEvent) => void) | undefined;
    bindEventBus({ emit: () => {}, onAny(listener) { receive = listener; return () => {}; } });
    if (receive === undefined) throw new Error('Missing real event logger subscription');
    const events: BusEvent[] = ['ChannelRail', 'MemberDirectory'].map(trait => ({ type: 'UI:BrowseItemLoaded', payload: { data: [{ id: trait }] }, timestamp: 10, source: { orbital: 'Chat', trait, dispatched: true } }));
    for (const event of events) receive(event);
    expect(window.__orbitalVerification?.eventLog).toEqual(events.map(event => ({ type: event.type, payload: event.payload, source: event.source, timestamp: expect.any(Number) })));
  });
  it('keeps source-less user events source-less with the complete payload', () => {
    let receive: ((event: BusEvent) => void) | undefined;
    bindEventBus({ emit: () => {}, onAny(listener) { receive = listener; return () => {}; } });
    if (receive === undefined) throw new Error('Missing real event logger subscription');
    receive({ type: 'UI:Chat.Composer.SEND', payload: { content: 'complete message' }, timestamp: 10 });
    expect(window.__orbitalVerification?.eventLog).toEqual([{ type: 'UI:Chat.Composer.SEND', payload: { content: 'complete message' }, timestamp: expect.any(Number) }]);
  });
});

describe('a hop the kernel observed for a verifier', () => {
  const observed = { payload: { amount: 3 }, entityBefore: { balance: 10 }, entityAfter: { balance: 7 } };
  it('is recorded on the transition the bridge returns', () => {
    createCircuitVerificationObserver().onTransition({ traitName: 'Wallet', from: 'active', to: 'active', event: 'SPEND', effects: [], observed });
    const recorded = window.__orbitalVerification?.getTransitions().filter((t) => t.event === 'SPEND');
    expect(recorded?.at(-1)?.observed).toEqual(observed);
  });
  it('control: a hop recorded without one carries none', () => {
    createCircuitVerificationObserver().onTransition({ traitName: 'Wallet', from: 'active', to: 'active', event: 'TOP_UP', effects: [] });
    const recorded = window.__orbitalVerification?.getTransitions().filter((t) => t.event === 'TOP_UP');
    expect(recorded?.at(-1)?.observed).toBeUndefined();
  });
});

describe('the arm a hop fired', () => {
  it('is recorded with no verifier attached', () => {
    createCircuitVerificationObserver().onTransition({ traitName: 'Wallet', from: 'active', to: 'active', event: 'REFUND', firedArm: 1, effects: [] });
    expect(window.__orbitalVerification?.getTransitions().filter((t) => t.event === 'REFUND').at(-1)?.firedArm).toBe(1);
  });
  it('control: an unreported arm stays absent', () => {
    createCircuitVerificationObserver().onTransition({ traitName: 'Wallet', from: 'active', to: 'active', event: 'CLOSE', effects: [] });
    expect(window.__orbitalVerification?.getTransitions().filter((t) => t.event === 'CLOSE').at(-1)?.firedArm).toBeUndefined();
  });
});

describe('verifierAttached', () => {
  afterEach(() => { delete (window as Window & { __ALMADAR_VERIFY__?: boolean }).__ALMADAR_VERIFY__; });
  it('is the explicit window flag a verifier sets before the bundle runs', () => {
    expect(verifierAttached()).toBe(false);
    (window as Window & { __ALMADAR_VERIFY__?: boolean }).__ALMADAR_VERIFY__ = true;
    expect(verifierAttached()).toBe(true);
  });
});
