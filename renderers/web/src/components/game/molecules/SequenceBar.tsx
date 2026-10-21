/**
 * SequenceBar Component
 *
 * A row of TraitSlot components forming the action sequence for the
 * Sequencer tier (ages 5-8). Kids drag ActionTiles from the palette
 * into these slots to build their sequence.
 *
 * @packageDocumentation
 */

import React, { useCallback } from 'react';
import type { A11yProps, EventEmit } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { HStack, Typography } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { TraitSlot } from './TraitSlot';
import type { SlotItemData } from './TraitSlot';

export interface SequenceBarProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
    /** The current sequence (sparse — undefined means empty slot) */
    slots: Array<SlotItemData | undefined>;
    /** Max number of slots */
    maxSlots: number;
    /** Called when an item is dropped into slot at index (callback path) */
    onSlotDrop?: (index: number, item: SlotItemData) => void;
    /** Called when a slot is cleared (callback path) */
    onSlotRemove?: (index: number) => void;
    /** Emits UI:{slotDropEvent} with { slotNumber, itemId } when an item is dropped (declarative path) */
    slotDropEvent?: EventEmit<{ slotNumber: number; itemId: string }>;
    /** Emits UI:{slotRemoveEvent} with { slotNumber } when a slot is cleared (declarative path) */
    slotRemoveEvent?: EventEmit<{ slotNumber: number }>;
    /** Whether the sequence is currently playing (disable interaction) */
    playing?: boolean;
    /** Current step index during playback (-1 = not playing) */
    currentStep?: number;
    /** Category → color mapping */
    categoryColors?: Record<string, { bg: string; border: string }>;
    /** Per-slot correctness feedback shown after a failed attempt */
    slotFeedback?: Array<'correct' | 'wrong' | null>;
    /** Size variant */
    size?: 'sm' | 'md' | 'lg';
    /** Additional CSS classes */
    className?: string;
}

export function SequenceBar({
    slots,
    maxSlots,
    onSlotDrop,
    onSlotRemove,
    slotDropEvent,
    slotRemoveEvent,
    playing = false,
    currentStep = -1,
    categoryColors,
    slotFeedback,
    size = 'lg',
    className,
    ...rest
}: SequenceBarProps): React.JSX.Element {
    const { emit } = useEventBus();

    const handleDrop = useCallback((index: number) => (item: SlotItemData) => {
        if (playing) return;
        if (slotDropEvent) emit(`UI:${slotDropEvent}`, { slotNumber: index, itemId: item.id });
        else onSlotDrop?.(index, item);
    }, [emit, slotDropEvent, onSlotDrop, playing]);

    const handleRemove = useCallback((index: number) => () => {
        if (playing) return;
        if (slotRemoveEvent) emit(`UI:${slotRemoveEvent}`, { slotNumber: index });
        else onSlotRemove?.(index);
    }, [emit, slotRemoveEvent, onSlotRemove, playing]);

    // Pad slots to maxSlots
    const paddedSlots = Array.from({ length: maxSlots }, (_, i) => slots[i]);

    return (
        <HStack {...domPassthrough(rest)} className={cn('items-center', className)} gap="sm">
            {paddedSlots.map((slot, i) => (
                <React.Fragment key={i}>
                    {i > 0 && (
                        <Typography
                            variant="body1"
                            className={cn(
                                'text-lg',
                                currentStep >= 0 && i <= currentStep ? 'text-primary' : 'text-muted-foreground',
                            )}
                        >
                            {'\u2192'}
                        </Typography>
                    )}
                    <TraitSlot
                        slotNumber={i + 1}
                        equippedItem={slot}
                        size={size}
                        categoryColors={categoryColors}
                        onItemDrop={handleDrop(i)}
                        onRemove={slot ? handleRemove(i) : undefined}
                        draggable={!playing && !!slot}
                        selected={currentStep === i}
                        locked={playing}
                        feedback={slotFeedback?.[i]}
                    />
                </React.Fragment>
            ))}
        </HStack>
    );
}

SequenceBar.displayName = 'SequenceBar';

export default SequenceBar;
