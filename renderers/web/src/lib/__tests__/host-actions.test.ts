import { describe, expect, it } from 'vitest';
import type { HostAudioAsk } from '@almadar/shell-runtime/kernel/host';
import { registerHostAudio, registerHostSignOut, webHostActions } from '../host-actions';

describe('web host actions', () => {
  it('routes the audio and sign-out asks to what the shell installed, and withdraws them on cleanup', () => {
    const heard: HostAudioAsk[] = [];
    let signedOut = 0;
    const offAudio = registerHostAudio((ask) => { heard.push(ask); });
    const offSignOut = registerHostSignOut(() => { signedOut += 1; });
    webHostActions.audio?.({ op: 'audio/play-sound', key: 'footstep' });
    void webHostActions.signOut?.();
    expect(heard).toEqual([{ op: 'audio/play-sound', key: 'footstep' }]);
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
