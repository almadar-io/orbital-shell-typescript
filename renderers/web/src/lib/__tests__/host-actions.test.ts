import { describe, expect, it } from 'vitest';
import type { HostAudioAsk } from '@almadar/shell-runtime/kernel/host';
import type { EventPayload } from '@almadar/core';
import { answerHostAsk, registerHostAudio, registerHostSignOut, webHostActions } from '../host-actions';

describe('web host actions', () => {
  it('routes the audio and sign-out asks to what the shell installed, and withdraws them on cleanup', () => {
    const heard: HostAudioAsk[] = [];
    let signedOut = 0;
    const offAudio = registerHostAudio((ask) => { heard.push(ask); });
    const offSignOut = registerHostSignOut(() => { signedOut += 1; });
    const step = { key: 'footstep', source: '/sfx/step.ogg', volume: 1, loop: false, poolSize: 1, fadeMs: 0 };
    webHostActions.audio?.({ op: 'audio/play-sound', play: step });
    void webHostActions.signOut?.();
    expect(heard).toEqual([{ op: 'audio/play-sound', play: step }]);
    expect(signedOut).toBe(1);
    offAudio();
    offSignOut();
    expect(webHostActions.audio).toBeUndefined();
    expect(webHostActions.signOut).toBeUndefined();
  });

  it('control: a stale cleanup does not remove a newer installation', () => {
    const first = registerHostAudio(() => undefined);
    const second = (ask: HostAudioAsk): void => { void ask; };
    const offSecond = registerHostAudio(second);
    first();
    expect(webHostActions.audio).toBe(second);
    offSecond();
  });
});

describe('os/audio-in on the web host: a microphone stream keyed by its call, answered on its success or failure route', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('answers invalid when the call has no key or no onMessage route to stream frames to', async () => {
    const seen: { event: string; payload: EventPayload }[] = [];
    const dispatch = async (_trait: string, event: string, payload: EventPayload): Promise<void> => { seen.push({ event, payload }); };
    await answerHostAsk('os/audio-in', [], { trait: 'Mic', success: 'MIC_OPEN', failure: 'MIC_FAILED' }, dispatch);
    expect(seen).toEqual([{ event: 'MIC_FAILED', payload: { error: 'os/audio-in streams only with a key, an onMessage route and a dispatch', kind: 'invalid' } }]);
  });

  it('answers unavailable, under its key, where the host has no microphone input', async () => {
    const seen: { event: string; payload: EventPayload }[] = [];
    const dispatch = async (_trait: string, event: string, payload: EventPayload): Promise<void> => { seen.push({ event, payload }); };
    await answerHostAsk('os/audio-in', [{ sampleRate: 16000, channels: 1 }], { trait: 'Mic', key: 'mic', success: 'MIC_OPEN', failure: 'MIC_FAILED', onMessage: 'MIC_FRAME' }, dispatch);
    await settle();
    expect(seen).toEqual([{ event: 'MIC_FAILED', payload: { error: 'this browser has no microphone input', kind: 'unavailable', key: 'mic' } }]);
  });

  it('control: cancel-call of a key with no open microphone closes nothing and answers nothing', async () => {
    const seen: string[] = [];
    await answerHostAsk('cancel-call', ['mic'], undefined, async (_trait, event) => { seen.push(event); });
    expect(seen).toEqual([]);
  });
});
