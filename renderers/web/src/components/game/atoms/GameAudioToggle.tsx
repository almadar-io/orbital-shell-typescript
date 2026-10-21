'use client';
/**
 * GameAudioToggle
 *
 * A small mute/unmute button for game HUDs. Self-contained: inside a
 * <GameAudioProvider> it drives the shared audio state; standalone it falls back
 * to a local muted state so it renders without a provider (the provider is an
 * implementation detail, not a precondition).
 *
 * Shows 🔊 when sound is on and 🔇 when muted.
 *
 * @packageDocumentation
 */

import React, { useCallback, useState } from 'react';
import type { A11yProps, Asset, EventEmit } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { Button } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { useGameAudioContextOptional } from '../../../providers/GameAudioProvider';
import { GameIcon } from '../../../core';
import type { UiError } from '../../../core';

// =============================================================================
// Props
// =============================================================================

export interface GameAudioToggleProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
    /** Button size */
    size?: 'sm' | 'md' | 'lg';
    /** Additional CSS classes */
    className?: string;
    /** Loading state (passed through) */
    isLoading?: boolean;
    /** Error state (passed through) */
    error?: UiError | null;
    /** Asset rendered when sound is ON. Falls back to 🔊 emoji. */
    onAsset?: Asset;
    /** Asset rendered when sound is OFF (muted). Falls back to 🔇 emoji. */
    offAsset?: Asset;
    /** Event dispatched via event bus on toggle, carrying the new muted state. */
    toggleEvent?: EventEmit<{ muted: boolean }>;
    /** Entity name for schema-driven auto-fetch */
}

// =============================================================================
// Component
// =============================================================================


export function GameAudioToggle({
    size = 'sm',
    className,
    onAsset,
    offAsset,
    toggleEvent,
    ...rest
}: GameAudioToggleProps): React.JSX.Element {
    const ctx = useGameAudioContextOptional();
    const [localMuted, setLocalMuted] = useState(false);
    const muted = ctx ? ctx.muted : localMuted;
    const setMuted = ctx ? ctx.setMuted : setLocalMuted;
    const eventBus = useEventBus();
    const { t } = useTranslate();
    const stateLabel = muted ? t('gameAudio.muted') : t('gameAudio.soundOn');

    const handleToggle = useCallback(() => {
        const next = !muted;
        setMuted(next);
        if (toggleEvent) eventBus.emit(`UI:${toggleEvent}`, { muted: next });
    }, [muted, setMuted, toggleEvent, eventBus]);

    const activeAsset = muted ? offAsset : onAsset;

    return (
        <Button
            {...domPassthrough(rest)}
            variant="ghost"
            size={size}
            onClick={handleToggle}
            className={cn('text-lg leading-none px-2', className)}
            aria-pressed={muted}
            aria-label={rest['aria-label'] ?? stateLabel}
        >
            {activeAsset ? (
                <GameIcon assetUrl={activeAsset} icon="image" size={20} alt={stateLabel} className="w-5 h-5 object-contain" />
            ) : (
                muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'
            )}
        </Button>
    );
}

GameAudioToggle.displayName = 'GameAudioToggle';

export default GameAudioToggle;
