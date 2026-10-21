'use client';
/**
 * `game-audio-cue` — declarative audio driver (dimension-agnostic).
 *
 * Renders null; mounts the package's `useGameAudio` hook and keeps it in
 * sync with props so a state machine can own cue/music/mute/volume as
 * ordinary entity fields. `cueSeq` is the re-trigger signal for `cue` — a
 * one-shot fires on every `cueSeq` bump, even when `cue` repeats the same
 * key, and never on mount.
 */
import { useEffect, useRef } from 'react';
import { useGameAudio } from '../../../hooks/useGameAudio';
import type { SoundEntry } from '@almadar/core';

export interface GameAudioCueProps {
    /** Manifest key played as a one-shot SFX each time `cueSeq` advances. */
    cue?: string;
    /** Monotonically increasing counter — bumping it re-triggers `cue`. */
    cueSeq?: number;
    /** Manifest key to crossfade to as looping background music; unset/empty stops music. */
    music?: string;
    /** Muted state, owned externally and mirrored into the hook. */
    muted?: boolean;
    /** Master volume 0-1, owned externally and mirrored into the hook. */
    volume?: number;
    /** Sound manifest — keys mapped to sound definitions (path, volume, loop, ...). */
    manifest: Record<string, SoundEntry>;
    /** Base URL prepended to every manifest path. */
    baseUrl?: string;
}

export function GameAudioCue({
    cue,
    cueSeq,
    music,
    muted,
    volume,
    manifest,
    baseUrl,
}: GameAudioCueProps): null {
    const { play, playMusic, stopMusic, setMuted, setMasterVolume } = useGameAudio({
        manifest,
        baseUrl,
        initialMuted: muted,
        initialVolume: volume,
    });

    const prevCueSeqRef = useRef(cueSeq);
    useEffect(() => {
        if (cue && cueSeq !== undefined && cueSeq !== prevCueSeqRef.current) {
            play(cue);
        }
        prevCueSeqRef.current = cueSeq;
    }, [cue, cueSeq, play]);

    useEffect(() => {
        if (music) playMusic(music);
        else stopMusic();
    }, [music, playMusic, stopMusic]);

    useEffect(() => {
        if (muted !== undefined) setMuted(muted);
    }, [muted, setMuted]);

    useEffect(() => {
        if (volume !== undefined) setMasterVolume(volume);
    }, [volume, setMasterVolume]);

    return null;
}

GameAudioCue.displayName = 'GameAudioCue';

export default GameAudioCue;
