'use client';
/**
 * useGameAudio Hook
 *
 * React access to an {@link AudioOut}: its own, released on unmount, or one passed in (the shell's,
 * which the `audio/*` host asks play through) that outlives the component.
 *
 * Two separate systems, both playing what std-audio-cue resolved (`AudioPlay`):
 *   SFX pool:    playPlan(plan)  — instant, concurrent, pooled instances
 *   Music player: playMusicPlan(plan) — crossfades between looping background tracks
 *
 * Autoplay policy:
 *   Browsers block audio until a user gesture. This hook registers a one-time
 *   listener (click/keydown/touchstart) that:
 *   - Starts the resolved `autostart` sounds
 *   - Plays any pending music that was requested before unlock
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AudioOut } from '../lib/audio-out';

// =============================================================================
// Types
// =============================================================================

/** Core owns the sound-manifest shape (`@almadar/core` `types/asset.ts`) so the
 *  pattern extractor and the generated `.lolo` factories resolve the same
 *  declaration; re-exported here for the hook's existing consumers. */
export type { SoundEntry, AudioManifest, AudioPlay } from '@almadar/core';
import type { AudioPlay } from '@almadar/core';

export interface GameAudioControls {
    /** Play a sound std-audio-cue already resolved */
    playPlan: (plan: AudioPlay) => void;
    /** Crossfade to a resolved track; an empty key fades out over `fadeMs` */
    playMusicPlan: (plan: AudioPlay) => void;
    /** Stop all instances of a sound effect */
    stop: (key: string) => void;
    /** Stop all sounds including music */
    stopAll: () => void;
    /** Fade out over `fadeDurationMs` and stop the current music */
    stopMusic: (fadeDurationMs: number) => void;
    muted: boolean;
    setMuted: (muted: boolean) => void;
    masterVolume: number;
    setMasterVolume: (volume: number) => void;
}

export interface UseGameAudioOptions {
    /** Start muted (default false) */
    initialMuted?: boolean;
    /** Master volume 0–1 (default 1) */
    initialVolume?: number;
    /** Resolved sounds to start on the first user gesture */
    autostart?: AudioPlay[];
    /** Play through this audio instead of one owned by the component */
    out?: AudioOut;
}

// =============================================================================
// Hook
// =============================================================================

export function useGameAudio({
    initialMuted = false,
    initialVolume = 1,
    autostart,
    out: shared,
}: UseGameAudioOptions): GameAudioControls {
    const [owned] = useState(() => (shared ? null : new AudioOut(initialMuted, initialVolume)));
    const out = shared ?? owned;
    if (!out) throw new Error('useGameAudio has neither its own audio nor one passed in');

    useEffect(() => () => owned?.dispose(), [owned]);

    const muted = useSyncExternalStore((listener) => out.subscribe(listener), () => out.muted, () => out.muted);
    const masterVolume = useSyncExternalStore((listener) => out.subscribe(listener), () => out.masterVolume, () => out.masterVolume);

    const autostartSignature = (autostart ?? []).map((p) => p.key + '\u0000' + p.source).join('\u0001');
    const autostartPlans = useMemo(() => autostart ?? [], [autostartSignature]);
    useEffect(() => {
        out.setAutostart(autostartPlans);
    }, [out, autostartPlans]);

    return useMemo(() => ({
        playPlan: (plan: AudioPlay) => out.playPlan(plan),
        playMusicPlan: (plan: AudioPlay) => out.playMusicPlan(plan),
        stop: (key: string) => out.stop(key),
        stopAll: () => out.stopAll(),
        stopMusic: (fadeDurationMs: number) => out.stopMusic(fadeDurationMs),
        muted,
        setMuted: (value: boolean) => out.setMuted(value),
        masterVolume,
        setMasterVolume: (volume: number) => out.setMasterVolume(volume),
    }), [out, muted, masterVolume]);
}

useGameAudio.displayName = 'useGameAudio';
