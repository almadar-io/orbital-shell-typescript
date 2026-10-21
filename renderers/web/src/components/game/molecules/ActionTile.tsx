 
/**
 * ActionTile Component
 *
 * A draggable action tile for the Sequencer tier (ages 5-8).
 * Kids drag these from the ActionPalette into SequenceBar slots.
 * Sets SlotItemData on dataTransfer for TraitSlot compatibility.
 *
 * @packageDocumentation
 */

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../../core';
import React, { useCallback } from 'react';
import { Box, Typography } from '../../../core';
import { cn } from '../../../core';
import { useTranslate } from '../../../core';
import type { DisplayStateProps } from '../../core/organisms/types';
import type { SlotItemData } from './TraitSlot';

export interface ActionTileProps extends DisplayStateProps, Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
    /** The action data */
    action: SlotItemData;
    /** Size variant */
    size?: 'sm' | 'md' | 'lg';
    /** Whether the tile is disabled / already used */
    disabled?: boolean;
    /** Category → color mapping */
    categoryColors?: Record<string, { bg: string; border: string }>;
}

const DRAG_MIME = 'application/x-almadar-slot-item';

const SIZE_CONFIG = {
    sm: { px: 'px-2 py-1', icon: 'text-lg', text: 'text-xs' },
    md: { px: 'px-3 py-2', icon: 'text-2xl', text: 'text-sm' },
    lg: { px: 'px-4 py-3', icon: 'text-3xl', text: 'text-base' },
};

export function ActionTile({
    action,
    size = 'md',
    disabled = false,
    categoryColors,
    className,
    ...rest
}: ActionTileProps): React.JSX.Element {
    useTranslate(); // imported for i18n readiness — all visible text is data-driven
    const config = SIZE_CONFIG[size];
    const catColor = categoryColors?.[action.category];

    const handleDragStart = useCallback((e: React.DragEvent) => {
        if (disabled) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(action));
        e.dataTransfer.effectAllowed = 'copy';
    }, [action, disabled]);

    return (
        <Box
            {...domPassthrough(rest)}
            display="flex"
            className={cn(
                'flex-col items-center gap-1 rounded-container border-heavy transition-all select-none',
                config.px,
                disabled
                    ? 'opacity-40 cursor-not-allowed border-border bg-muted'
                    : 'cursor-grab active:cursor-grabbing hover:scale-105 hover:shadow-elevation-popover border-border bg-card',
                className,
            )}
            style={{
                backgroundColor: !disabled && catColor ? catColor.bg : undefined,
                borderColor: !disabled && catColor ? catColor.border : undefined,
            }}
            draggable={!disabled}
            onDragStart={handleDragStart}
        >
            {action.iconUrl ? (
                <img src={action.iconUrl.url} alt="" className="w-8 h-8 object-contain" />
            ) : (
                <Typography variant="body1" className={cn(config.icon, 'leading-none')}>
                    {action.iconEmoji || '\u2726'}
                </Typography>
            )}
            <Typography variant="caption" className={cn(config.text, 'text-foreground font-medium whitespace-nowrap')}>
                {action.name}
            </Typography>
        </Box>
    );
}

ActionTile.displayName = 'ActionTile';

export default ActionTile;
