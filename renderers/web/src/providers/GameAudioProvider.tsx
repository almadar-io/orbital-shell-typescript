'use client';
/**
 * GameAudioProvider
 *
 * Exposes the shell's audio (the one the kernel's `audio/*` host asks play through, mounted or
 * not) as `muted`/`setMuted` and `masterVolume`/`setMasterVolume` via the `GameAudioContext`
 * for toggle buttons.
 *
 * Closed-circuit props (`className`, `isLoading`, `error`) are
 * accepted but intentionally unused — the provider renders only its children.
 *
 * @packageDocumentation
 */

import React, { createContext, useContext, useEffect } from 'react';
import { shellAudio } from '../lib/audio-out';
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
    initialMuted,
}: GameAudioProviderProps): React.JSX.Element {
    const { playPlan, playMusicPlan, stopMusic, muted, setMuted, masterVolume, setMasterVolume } =
        useGameAudio({ out: shellAudio });

    useEffect(() => {
        if (initialMuted !== undefined) shellAudio.setMuted(initialMuted);
    }, [initialMuted]);

    const value: GameAudioContextValue = { muted, setMuted, masterVolume, setMasterVolume, playPlan, playMusicPlan, stopMusic };

    return (
        <GameAudioContext.Provider value={value}>
            {children}
        </GameAudioContext.Provider>
    );
}

GameAudioProvider.displayName = 'GameAudioProvider';

export default GameAudioProvider;
