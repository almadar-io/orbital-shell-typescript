'use client';
/**
 * GameAudioProvider
 *
 * Context provider that owns the game audio. While it is mounted, the kernel's
 * `audio/play-sound`, `audio/stop-sound`, `audio/change-music` and `audio/stop-music`
 * asks drive it.
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
import { useGameAudio, type AudioManifest, type GameAudioControls } from '../hooks/useGameAudio';
import type { UiError } from '../core';

// =============================================================================
// Context
// =============================================================================

export type GameAudioContextValue = Pick<GameAudioControls,
    'muted' | 'setMuted' | 'masterVolume' | 'setMasterVolume' | 'play' | 'playMusic' | 'stopMusic'
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
    /** Sound manifest — keys mapped to SoundEntry definitions */
    manifest: AudioManifest;
    /** Base URL prepended to all sound paths (default '') */
    baseUrl?: string;
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
    manifest,
    baseUrl = '',
    children,
    initialMuted = false,
}: GameAudioProviderProps): React.JSX.Element {
    const { play, stop, stopAll, playMusic, stopMusic, muted, setMuted, masterVolume, setMasterVolume } =
        useGameAudio({ manifest, baseUrl, initialMuted });

    // The `audio/*` asks the kernel makes reach this provider's audio
    useEffect(() => registerHostAudio((ask) => {
        if (ask.op === 'audio/play-sound') play(ask.key);
        else if (ask.op === 'audio/stop-sound') {
            if (ask.key !== undefined) stop(ask.key);
            else stopAll();
        } else if (ask.op === 'audio/change-music') {
            if (ask.key !== undefined) playMusic(ask.key);
            else stopMusic();
        } else stopMusic();
    }), [play, stop, stopAll, playMusic, stopMusic]);

    const value: GameAudioContextValue = { muted, setMuted, masterVolume, setMasterVolume, play, playMusic, stopMusic };

    return (
        <GameAudioContext.Provider value={value}>
            {children}
        </GameAudioContext.Provider>
    );
}

GameAudioProvider.displayName = 'GameAudioProvider';

export default GameAudioProvider;
