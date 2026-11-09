import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { AudioPlay } from '@almadar/core';
import { GameAudioCue } from '../GameAudioCue';

class FakeAudio {
  static created: FakeAudio[] = [];
  src: string;
  loop = false;
  volume = 1;
  paused = true;
  ended = false;
  currentTime = 0;
  plays = 0;
  constructor(src: string) {
    this.src = src;
    FakeAudio.created.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    this.plays += 1;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

const coin: AudioPlay = { key: 'coin', source: '/sfx/coin.mp3', volume: 0.5, loop: false, poolSize: 2, fadeMs: 0 };
const theme: AudioPlay = { key: 'theme', source: '/music/theme.mp3', volume: 1, loop: true, poolSize: 1, fadeMs: 1500 };
const stop: AudioPlay = { key: '', source: '', volume: 0, loop: true, poolSize: 1, fadeMs: 1000 };

function cue(props: { cueSeq: number; muted?: boolean; musicPlay?: AudioPlay }) {
  return (
    <GameAudioCue
      cueSeq={props.cueSeq}
      cuePlay={coin}
      musicPlay={props.musicPlay ?? stop}
      autostart={[]}
      muted={props.muted ?? false}
      volume={0.8}
    />
  );
}

describe('GameAudioCue plays the plans std-audio-cue resolved', () => {
  beforeEach(() => {
    FakeAudio.created = [];
    vi.stubGlobal('Audio', FakeAudio);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plays cuePlay from its own source and volume only when cueSeq moves after mount', () => {
    const view = render(cue({ cueSeq: 0 }));
    expect(FakeAudio.created).toHaveLength(0);
    view.rerender(cue({ cueSeq: 1 }));
    expect(FakeAudio.created.map((a) => a.src)).toEqual(['/sfx/coin.mp3']);
    expect(FakeAudio.created[0].volume).toBeCloseTo(0.4);
    view.rerender(cue({ cueSeq: 1 }));
    expect(FakeAudio.created[0].plays).toBe(1);
  });

  it('plays nothing for a cue while muted', () => {
    const view = render(cue({ cueSeq: 0, muted: true }));
    view.rerender(cue({ cueSeq: 1, muted: true }));
    expect(FakeAudio.created).toHaveLength(0);
  });

  it('starts musicPlay from its source and an empty music key starts nothing', () => {
    const view = render(cue({ cueSeq: 0 }));
    expect(FakeAudio.created).toHaveLength(0);
    view.rerender(cue({ cueSeq: 0, musicPlay: theme }));
    expect(FakeAudio.created.map((a) => [a.src, a.loop])).toEqual([['/music/theme.mp3', true]]);
  });
});
