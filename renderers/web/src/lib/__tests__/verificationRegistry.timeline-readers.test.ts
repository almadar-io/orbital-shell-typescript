// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { EventResponse } from '@almadar/core';
import type { EventTransport } from '../../index';
import { attachTimelineReader, clearVerification, getAllChecks, getTransitions, recordingTransport } from '../verificationRegistry';

type VerifyFlag = Window & { __ALMADAR_VERIFY__?: boolean };

const program = { name: 'big', orbitals: [{ name: 'A' }] };
const answer = (over: Partial<EventResponse> = {}): EventResponse => ({
  success: true, transitioned: true, states: {}, emittedEvents: [{ event: 'GUEST_CLIENT', payload: { guest: 'g', program } }], ...over,
});
const transportAnswering = (response: EventResponse): EventTransport => ({
  register: async () => ({ success: true, carriesCircuitState: false }),
  unregister: async () => undefined,
  send: async () => response,
});

afterEach(() => {
  delete (window as VerifyFlag).__ALMADAR_VERIFY__;
  clearVerification();
});

describe('the verification timeline keeps answers only while someone reads it', () => {
  it('keeps no answer, and so no payload, with neither a verifier nor a reader attached', async () => {
    await recordingTransport(transportAnswering(answer())).send('Launchpad', { event: 'LOAD_BEHAVIOR' });
    expect(getTransitions()).toEqual([]);
  });

  it('control: an attached reader sees the answer with its emitted payload', async () => {
    const detach = attachTimelineReader();
    await recordingTransport(transportAnswering(answer())).send('Launchpad', { event: 'LOAD_BEHAVIOR' });
    detach();
    expect(getTransitions()).toHaveLength(1);
    expect(getTransitions()[0]?.serverResponse?.emitted?.[0]?.payload).toEqual({ guest: 'g', program });
  });

  it('control: a verifier sees the answer with no reader attached', async () => {
    (window as VerifyFlag).__ALMADAR_VERIFY__ = true;
    await recordingTransport(transportAnswering(answer())).send('Launchpad', { event: 'LOAD_BEHAVIOR' });
    expect(getTransitions()).toHaveLength(1);
  });

  it('edge: once the last reader detaches, later answers are not kept', async () => {
    const first = attachTimelineReader();
    const second = attachTimelineReader();
    first();
    await recordingTransport(transportAnswering(answer())).send('Launchpad', { event: 'ONE' });
    second();
    await recordingTransport(transportAnswering(answer())).send('Launchpad', { event: 'TWO' });
    expect(getTransitions().map((t) => t.event)).toEqual(['ONE']);
  });

  it('edge: a failed answer still registers its server-error check with nobody reading', async () => {
    await recordingTransport(transportAnswering(answer({ success: false, error: 'boom' }))).send('Launchpad', { event: 'BAD' });
    expect(getTransitions()).toEqual([]);
    expect(getAllChecks().some((c) => c.status === 'fail' && c.details === 'boom')).toBe(true);
  });
});
