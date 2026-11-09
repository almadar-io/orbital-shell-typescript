import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { AudioPlay } from '@almadar/core';
import { GameAudioProvider } from '../GameAudioProvider';
import { webHostActions } from '../../lib/host-actions';

class FakeAudio {
  static created: FakeAudio[] = [];
  src: string;
  loop = false;
  volume = 1;
  paused = true;
  ended = false;
  currentTime = 0;
  constructor(src: string) {
    this.src = src;
    FakeAudio.created.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

const step: AudioPlay = { key: 'footstep', source: '/sfx/step-2.ogg', volume: 0.5, loop: false, poolSize: 2, fadeMs: 0 };
const theme: AudioPlay = { key: 'theme', source: '/music/theme.ogg', volume: 1, loop: true, poolSize: 1, fadeMs: 0 };

describe('GameAudioProvider answers the audio/* port with what std-audio-cue resolved', () => {
  beforeEach(() => {
    FakeAudio.created = [];
    vi.stubGlobal('Audio', FakeAudio);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('plays a resolved sound from its own source and volume, and a resolved track looping', () => {
    render(<GameAudioProvider><span /></GameAudioProvider>);
    act(() => webHostActions.audio?.({ op: 'audio/play-sound', play: step }));
    act(() => webHostActions.audio?.({ op: 'audio/change-music', play: theme }));
    expect(FakeAudio.created.map((a) => [a.src, a.loop])).toEqual([['/sfx/step-2.ogg', false], ['/music/theme.ogg', true]]);
    expect(FakeAudio.created[0].volume).toBeCloseTo(0.5);
  });

  it('stops the music over the fade length the ask carries, not one the host picks', () => {
    render(<GameAudioProvider><span /></GameAudioProvider>);
    act(() => webHostActions.audio?.({ op: 'audio/change-music', play: theme }));
    const music = FakeAudio.created[0];
    act(() => webHostActions.audio?.({ op: 'audio/stop-music', fadeMs: 400 }));
    act(() => { vi.advanceTimersByTime(200); });
    expect(music.paused).toBe(false);
    act(() => { vi.advanceTimersByTime(400); });
    expect(music.paused).toBe(true);
  });

  it('control: with no provider mounted the port has no audio to answer it', () => {
    expect(webHostActions.audio).toBeUndefined();
  });
});
