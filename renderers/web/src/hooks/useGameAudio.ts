'use client';
/**
 * useGameAudio Hook
 *
 * Manages HTMLAudioElement pools for low-latency, concurrent sound playback,
 * plus a dedicated music player with crossfade transitions.
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

import { useRef, useState, useCallback, useEffect } from 'react';

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
}

// =============================================================================
// Internal helpers
// =============================================================================

type AudioPool = HTMLAudioElement[];

// =============================================================================
// Hook
// =============================================================================

export function useGameAudio({
    initialMuted = false,
    initialVolume = 1,
    autostart,
}: UseGameAudioOptions): GameAudioControls {
    const [muted, setMutedState] = useState(initialMuted);
    const [masterVolume, setMasterVolumeState] = useState(initialVolume);

    // Refs avoid stale closures in RAF / setTimeout / interval callbacks
    const mutedRef = useRef(muted);
    const volumeRef = useRef(masterVolume);
    mutedRef.current = muted;
    volumeRef.current = masterVolume;

    // -------------------------------------------------------------------------
    // SFX pool
    // -------------------------------------------------------------------------

    const poolsRef = useRef(new Map<string, AudioPool>());
    const poolPlansRef = useRef(new Map<string, AudioPlay>());

    const getOrCreateElement = useCallback((plan: AudioPlay): HTMLAudioElement | null => {
        const key = plan.key;
        poolPlansRef.current.set(key, plan);
        let pool = poolsRef.current.get(key);
        if (!pool) {
            pool = [];
            poolsRef.current.set(key, pool);
        }

        const maxSize = Math.max(1, plan.poolSize);

        // Prefer a finished/idle element
        for (const audio of pool) {
            if (audio.paused && (audio.ended || audio.currentTime === 0)) {
                return audio;
            }
        }

        // Create a new element if pool isn't at capacity
        if (pool.length < maxSize) {
            const audio = new Audio(plan.source);
            audio.loop = plan.loop;
            pool.push(audio);
            return audio;
        }

        // Pool full: for non-looping sounds, reuse the furthest-along one
        if (!plan.loop) {
            let oldest = pool[0];
            for (const audio of pool) {
                if (audio.currentTime > oldest.currentTime) {
                    oldest = audio;
                }
            }
            oldest.pause();
            oldest.currentTime = 0;
            oldest.src = plan.source;
            return oldest;
        }

        // Looping sound already playing — don't interrupt
        return null;
    }, []);

    const playPlan = useCallback((plan: AudioPlay) => {
        if (mutedRef.current || !plan.key) return;

        const audio = getOrCreateElement(plan);
        if (!audio) return;

        audio.volume = Math.min(1, plan.volume * volumeRef.current);
        if (!plan.loop) {
            audio.currentTime = 0;
        }

        const promise = audio.play();
        if (promise) {
            promise.catch(() => {
                // Autoplay blocked — silently ignored. The unlock mechanism
                // will start autostart sounds after the first user gesture.
            });
        }
    }, [getOrCreateElement]);

    const stop = useCallback((key: string) => {
        const pool = poolsRef.current.get(key);
        if (!pool) return;
        for (const audio of pool) {
            audio.pause();
            audio.currentTime = 0;
        }
    }, []);

    // -------------------------------------------------------------------------
    // Music player (crossfade)
    // -------------------------------------------------------------------------

    const currentMusicKeyRef = useRef<string | null>(null);
    const currentMusicPlanRef = useRef<AudioPlay | null>(null);
    const currentMusicElRef = useRef<HTMLAudioElement | null>(null);
    const musicFadeRef = useRef<ReturnType<typeof setInterval> | null>(null);
    /** Music requested before browser unlock — played on first gesture */
    const pendingMusicRef = useRef<AudioPlay | null>(null);

    const clearMusicFade = useCallback(() => {
        if (musicFadeRef.current) {
            clearInterval(musicFadeRef.current);
            musicFadeRef.current = null;
        }
    }, []);

    const startMusicPlan = useCallback((plan: AudioPlay) => {
        if (plan.key === currentMusicKeyRef.current) return;
        pendingMusicRef.current = plan;

        const stepMs = 50;
        const totalSteps = Math.max(1, plan.fadeMs / stepMs);
        const targetVolume = Math.min(1, plan.volume * volumeRef.current);

        clearMusicFade();

        const incoming = new Audio(plan.source);
        incoming.loop = true;
        incoming.volume = 0;

        const outgoing = currentMusicElRef.current;
        const outgoingStartVol = outgoing?.volume ?? 0;
        const outgoingKey = currentMusicKeyRef.current;
        const outgoingPlan = currentMusicPlanRef.current;

        currentMusicKeyRef.current = plan.key;
        currentMusicPlanRef.current = plan;
        currentMusicElRef.current = incoming;

        if (!mutedRef.current) {
            incoming.play().catch(() => {
                // Blocked — will retry when user interacts (pendingMusicRef is set)
                currentMusicKeyRef.current = outgoingKey;
                currentMusicPlanRef.current = outgoingPlan;
                currentMusicElRef.current = outgoing;
            });
        }

        let step = 0;
        musicFadeRef.current = setInterval(() => {
            step++;
            const progress = Math.min(step / totalSteps, 1);

            // Fade in incoming
            incoming.volume = Math.min(1, targetVolume * progress);

            // Fade out outgoing
            if (outgoing) {
                outgoing.volume = Math.max(0, outgoingStartVol * (1 - progress));
            }

            if (progress >= 1) {
                clearMusicFade();
                if (outgoing) {
                    outgoing.pause();
                    outgoing.src = '';
                }
            }
        }, stepMs);
    }, [clearMusicFade]);

    const stopMusic = useCallback((fadeDurationMs: number) => {
        pendingMusicRef.current = null;
        const outgoing = currentMusicElRef.current;
        if (!outgoing) return;

        currentMusicKeyRef.current = null;
        currentMusicPlanRef.current = null;
        currentMusicElRef.current = null;
        clearMusicFade();

        const startVolume = outgoing.volume;
        const stepMs = 50;
        const totalSteps = Math.max(1, fadeDurationMs / stepMs);
        let step = 0;

        musicFadeRef.current = setInterval(() => {
            step++;
            const progress = step / totalSteps;
            outgoing.volume = Math.max(0, startVolume * (1 - progress));
            if (progress >= 1) {
                clearMusicFade();
                outgoing.pause();
                outgoing.src = '';
            }
        }, stepMs);
    }, [clearMusicFade]);

    const playMusicPlan = useCallback((plan: AudioPlay) => {
        if (plan.key) startMusicPlan(plan);
        else stopMusic(plan.fadeMs);
    }, [startMusicPlan, stopMusic]);

    // -------------------------------------------------------------------------
    // Mute / volume controls
    // -------------------------------------------------------------------------

    const stopAll = useCallback(() => {
        for (const pool of poolsRef.current.values()) {
            for (const audio of pool) {
                audio.pause();
                audio.currentTime = 0;
            }
        }
        stopMusic(0);
    }, [stopMusic]);

    const setMuted = useCallback((value: boolean) => {
        setMutedState(value);
        if (value) {
            // Pause all looping SFX
            for (const [key, pool] of poolsRef.current.entries()) {
                if (poolPlansRef.current.get(key)?.loop) {
                    for (const audio of pool) {
                        if (!audio.paused) audio.pause();
                    }
                }
            }
            // Pause music
            currentMusicElRef.current?.pause();
        } else {
            // Resume looping autostart SFX
            for (const [key, pool] of poolsRef.current.entries()) {
                if (poolPlansRef.current.get(key)?.loop && autostartKeysRef.current.has(key)) {
                    for (const audio of pool) {
                        if (audio.paused) audio.play().catch(() => {});
                    }
                }
            }
            // Resume music
            const musicEl = currentMusicElRef.current;
            if (musicEl) {
                musicEl.play().catch(() => {});
            }
        }
    }, []);

    const setMasterVolume = useCallback((volume: number) => {
        const clamped = Math.max(0, Math.min(1, volume));
        setMasterVolumeState(clamped);
        // Update all SFX elements
        for (const [key, pool] of poolsRef.current.entries()) {
            const entryVol = poolPlansRef.current.get(key)?.volume ?? 1;
            for (const audio of pool) {
                audio.volume = Math.min(1, entryVol * clamped);
            }
        }
        // Update music element (only if not mid-fade)
        if (!musicFadeRef.current && currentMusicElRef.current) {
            const entryVol = currentMusicPlanRef.current?.volume ?? 1;
            currentMusicElRef.current.volume = Math.min(1, entryVol * clamped);
        }
    }, []);

    // -------------------------------------------------------------------------
    // Autoplay unlock (first user gesture)
    // -------------------------------------------------------------------------

    const unlockedRef = useRef(false);
    const autostartPlans = autostart ?? [];
    const autostartKeysRef = useRef(new Set<string>());
    autostartKeysRef.current = new Set(autostartPlans.map(p => p.key));
    const autostartRef = useRef(autostartPlans);
    autostartRef.current = autostartPlans;
    const autostartSignature = autostartPlans.map(p => p.key + '\u0000' + p.source).join('\u0001');

    useEffect(() => {
        const hasPendingMusic = () => pendingMusicRef.current !== null;
        const hasAutoStart = autostartRef.current.length > 0;

        if (!hasAutoStart && !hasPendingMusic()) return;

        const unlock = () => {
            if (unlockedRef.current) return;
            unlockedRef.current = true;

            if (!mutedRef.current) {
                for (const plan of autostartRef.current) {
                    playPlan(plan);
                }
                // Play pending music (requested before unlock)
                const pending = pendingMusicRef.current;
                if (pending && pending.key !== currentMusicKeyRef.current) {
                    startMusicPlan(pending);
                }
            }
        };

        document.addEventListener('click', unlock, { once: true });
        document.addEventListener('keydown', unlock, { once: true });
        document.addEventListener('touchstart', unlock, { once: true });

        return () => {
            document.removeEventListener('click', unlock);
            document.removeEventListener('keydown', unlock);
            document.removeEventListener('touchstart', unlock);
        };
    }, [autostartSignature, playPlan, startMusicPlan]);

    // -------------------------------------------------------------------------
    // Cleanup on unmount
    // -------------------------------------------------------------------------

    useEffect(() => {
        return () => {
            clearMusicFade();
            for (const pool of poolsRef.current.values()) {
                for (const audio of pool) {
                    audio.pause();
                    audio.src = '';
                }
            }
            poolsRef.current.clear();
            if (currentMusicElRef.current) {
                currentMusicElRef.current.pause();
                currentMusicElRef.current.src = '';
                currentMusicElRef.current = null;
            }
        };
    }, [clearMusicFade]);

    return {
        stop, stopAll,
        playPlan, playMusicPlan,
        stopMusic,
        muted, setMuted,
        masterVolume, setMasterVolume,
    };
}

useGameAudio.displayName = 'useGameAudio';
