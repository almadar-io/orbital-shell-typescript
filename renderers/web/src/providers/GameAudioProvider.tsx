'use client';
/**
 * GameAudioProvider
 *
 * Context provider that owns the game audio. While it is mounted, the kernel's
 * `audio/play-sound`, `audio/stop-sound`, `audio/change-music` and `audio/stop-music`
 * asks drive it: each carries what std-audio-cue resolved (the sound or track to play, or the
 * music fade-out length), so the provider plays it as given.
 *
 * The provider also exposes `muted`/`setMuted` and `masterVolume`/
 * `setMasterVolume` via the `GameAudioContext` for toggle buttons.
 *
 * Closed-circuit props (`className`, `isLoading`, `error`) are
 * accepted but intentionally unused — the provider renders only its children.
 *
 * @packageDocumentation
 */

import React, { createContext, useContext, useEffect } from 'react';
import { registerHostAudio } from '../lib/host-actions';
import { useGameAudio, type GameAudioControls } from '../hooks/useGameAudio';
import type { UiError } from '../core';

// =============================================================================
// Context
// =============================================================================

export type GameAudioContextValue = Pick<GameAudioControls,
    'muted' | 'setMuted' | 'masterVolume' | 'setMasterVolume' | 'playPlan' | 'playMusicPlan' | 'stopMusic'
>;

 
export const GameAudioContext = createContext<GameAudioContextValue | null>(null);
GameAudioContext.displayName = 'GameAudioContext';

/**
 * Access the game audio context.
 * Must be called from within a `<GameAudioProvider>` tree.
 */
export function useGameAudioContext(): GameAudioContextValue {
    const ctx = useContext(GameAudioContext);
    if (!ctx) {
        throw new Error('useGameAudioContext must be used inside <GameAudioProvider>');
    }
    return ctx;
}

/**
 * Access the game audio context, or `null` when there is no `<GameAudioProvider>`
 * ancestor. Lets a component stay self-contained (render standalone with a local
 * fallback) — the provider is an implementation detail, never a hard precondition.
 */
export function useGameAudioContextOptional(): GameAudioContextValue | null {
    return useContext(GameAudioContext);
}

// =============================================================================
// Props
// =============================================================================

export interface GameAudioProviderProps {
    /** Children to render */
    children: React.ReactNode;
    /** Initial muted state */
    initialMuted?: boolean;
    /** Closed-circuit props (unused, accepted for runtime compatibility) */
    className?: string;
    isLoading?: boolean;
    error?: UiError | null;
}

// =============================================================================
// Component
// =============================================================================

export function GameAudioProvider({
    children,
    initialMuted = false,
}: GameAudioProviderProps): React.JSX.Element {
    const { playPlan, playMusicPlan, stop, stopAll, stopMusic, muted, setMuted, masterVolume, setMasterVolume } =
        useGameAudio({ initialMuted });

    // The `audio/*` asks the kernel makes reach this provider's audio
    useEffect(() => registerHostAudio((ask) => {
        if (ask.op === 'audio/play-sound') playPlan(ask.play);
        else if (ask.op === 'audio/stop-sound') {
            if (ask.key !== undefined) stop(ask.key);
            else stopAll();
        } else if (ask.op === 'audio/change-music') playMusicPlan(ask.play);
        else stopMusic(ask.fadeMs);
    }), [playPlan, playMusicPlan, stop, stopAll, stopMusic]);

    const value: GameAudioContextValue = { muted, setMuted, masterVolume, setMasterVolume, playPlan, playMusicPlan, stopMusic };

    return (
        <GameAudioContext.Provider value={value}>
            {children}
        </GameAudioContext.Provider>
    );
}

GameAudioProvider.displayName = 'GameAudioProvider';

export default GameAudioProvider;
