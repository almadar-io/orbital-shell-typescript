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

describe('os/video-decode and os/video-feed on the web host: a keyed decoder fed samples, frames back on its onMessage route', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const collect = (): { seen: { event: string; payload: EventPayload }[]; dispatch: (trait: string, event: string, payload: EventPayload) => Promise<void> } => {
    const seen: { event: string; payload: EventPayload }[] = [];
    return { seen, dispatch: async (_trait, event, payload) => { seen.push({ event, payload }); } };
  };
  const route = { trait: 'Clip', key: 'clip', success: 'DECODER_OPEN', failure: 'DECODER_FAILED', onMessage: 'VIDEO_FRAME' };

  it('answers invalid for a config that is not { codec, description, codedWidth, codedHeight }', async () => {
    const { seen, dispatch } = collect();
    await answerHostAsk('os/video-decode', [{ codec: 'avc1.42E01E' }], route, dispatch);
    expect(seen).toEqual([{ event: 'DECODER_FAILED', payload: { error: 'os/video-decode: config is { codec, description, codedWidth, codedHeight }', kind: 'invalid', key: 'clip' } }]);
  });

  it('answers unavailable where the host has no video decoder', async () => {
    const { seen, dispatch } = collect();
    await answerHostAsk('os/video-decode', [{ codec: 'avc1.42E01E', description: 'AQID', codedWidth: 64, codedHeight: 64 }], route, dispatch);
    await settle();
    expect(seen).toEqual([{ event: 'DECODER_FAILED', payload: { error: 'this browser has no video decoder', kind: 'unavailable', key: 'clip' } }]);
  });

  it('control: feeding a key with no open decoder answers invalid and decodes nothing', async () => {
    const { seen, dispatch } = collect();
    await answerHostAsk('os/video-feed', ['nope', { data: 'AQID', timestamp: 0, key: true }], { trait: 'Clip', success: 'FED', failure: 'FEED_FAILED' }, dispatch);
    expect(seen).toEqual([{ event: 'FEED_FAILED', payload: { error: 'os/video-feed: no video decoder is open under that key', kind: 'invalid' } }]);
  });
});
