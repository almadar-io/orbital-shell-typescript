import { describe, expect, it } from 'vitest';
import type { EventPayload } from '@almadar/core';
import { answerHostAsk, registerHostSignOut, webHostActions } from '../host-actions';
import { answerAudioAsk } from '../audio-out';

describe('web host actions', () => {
  it('answers the audio asks on the shell audio, installed with no registration, and routes sign-out to what the shell installed', () => {
    expect(webHostActions.audio).toBe(answerAudioAsk);
    let signedOut = 0;
    const offSignOut = registerHostSignOut(() => { signedOut += 1; });
    void webHostActions.signOut?.();
    expect(signedOut).toBe(1);
    offSignOut();
    expect(webHostActions.signOut).toBeUndefined();
  });

  it('control: a stale cleanup does not remove a newer installation', () => {
    const first = registerHostSignOut(() => undefined);
    const second = (): void => undefined;
    const offSecond = registerHostSignOut(second);
    first();
    expect(webHostActions.signOut).toBe(second);
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
