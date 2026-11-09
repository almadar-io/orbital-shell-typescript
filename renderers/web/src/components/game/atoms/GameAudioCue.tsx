'use client';
/**
 * `game-audio-cue` — plays the sounds std-audio-cue has already resolved.
 *
 * Renders null. `cuePlay` fires on every `cueSeq` bump (never on mount),
 * `musicPlay` crossfades over its `fadeMs` (an empty key fades out),
 * `autostart` starts on the first user gesture while unmuted.
 */
import { useEffect, useRef } from 'react';
import { useGameAudio } from '../../../hooks/useGameAudio';
import type { AudioPlay } from '@almadar/core';

export interface GameAudioCueProps {
    /** Monotonically increasing counter — bumping it plays `cuePlay` once. */
    cueSeq?: number;
    /** The resolved one-shot to play on the next `cueSeq` bump. */
    cuePlay?: AudioPlay;
    /** The resolved looping track; an empty key fades the current one out. */
    musicPlay?: AudioPlay;
    /** Resolved sounds started on the first user gesture while unmuted. */
    autostart?: AudioPlay[];
    /** Muted state, owned externally and mirrored into the hook. */
    muted?: boolean;
    /** Master volume 0-1, owned externally and mirrored into the hook. */
    volume?: number;
}

export function GameAudioCue({
    cueSeq,
    cuePlay,
    musicPlay,
    autostart,
    muted,
    volume,
}: GameAudioCueProps): null {
    const { playPlan, playMusicPlan, setMuted, setMasterVolume } = useGameAudio({
        initialMuted: muted,
        initialVolume: volume,
        autostart: autostart ?? [],
    });

    const prevCueSeqRef = useRef(cueSeq);
    useEffect(() => {
        if (cuePlay && cueSeq !== undefined && cueSeq !== prevCueSeqRef.current) {
            playPlan(cuePlay);
        }
        prevCueSeqRef.current = cueSeq;
    }, [cuePlay, cueSeq, playPlan]);

    const musicKey = musicPlay?.key ?? '';
    const musicSource = musicPlay?.source ?? '';
    const musicRef = useRef(musicPlay);
    musicRef.current = musicPlay;
    useEffect(() => {
        if (musicRef.current) playMusicPlan(musicRef.current);
    }, [musicKey, musicSource, playMusicPlan]);

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
