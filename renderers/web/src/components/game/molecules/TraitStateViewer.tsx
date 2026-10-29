'use client';
/**
 * TraitStateViewer Component
 *
 * Displays a state machine visualization for a trait / behavior.
 * Three variants for different complexity levels:
 * - `linear`  — simple step progression (ages 5-8)
 * - `compact` — current state + available actions (ages 9-12)
 * - `full`    — all states, transitions, guards (ages 13+)
 *
 * @packageDocumentation
 */

import React from 'react';
import type { A11yProps } from '@almadar/core';
import { cn } from '../../../core';
import { pressableProps } from '../../../core';
import { domPassthrough, type DomPassthrough } from '../../../core';
import { useTranslate } from '../../../core';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { HStack, VStack } from '../../../core';
import { StateIndicator, type StateStyle } from '../atoms/StateIndicator';
import type { UiError } from '../../../core';

// =============================================================================
// Types
// =============================================================================

export type TraitTransition = {
    from: string;
    to: string;
    event: string;
    guardHint?: string;
};

export type TraitStateMachineDefinition = {
    name: string;
    states: string[];
    currentState: string;
    transitions: TraitTransition[];
    description?: string;
};

export interface TraitStateViewerProps extends A11yProps {
    /** The trait / state machine to visualize */
    trait: TraitStateMachineDefinition;
    /** Display variant */
    variant?: 'linear' | 'compact' | 'full';
    /** Size variant */
    size?: 'sm' | 'md' | 'lg';
    /** Whether to show transition labels */
    showTransitions?: boolean;
    /** Click handler for states */
    onStateClick?: (state: string) => void;
    /** Custom state styles passed to StateIndicator */
    stateStyles?: Record<string, StateStyle>;
    /** Additional CSS classes */
    className?: string;
    /** Loading state */
    isLoading?: boolean;
    /** Error state */
    error?: UiError | null;
}

const SIZE_CONFIG = {
    sm: { nodeSize: 'min-w-12 h-8', fontSize: 'text-xs', gap: 'gap-2' },
    md: { nodeSize: 'min-w-16 h-10', fontSize: 'text-sm', gap: 'gap-4' },
    lg: { nodeSize: 'min-w-20 h-12', fontSize: 'text-base', gap: 'gap-6' },
};

// =============================================================================
// Linear variant — step progression for young kids
// =============================================================================

function LinearView({
    trait,
    size = 'md',
    className,
    passthrough,
}: Pick<TraitStateViewerProps, 'trait' | 'size' | 'className'> & { passthrough: DomPassthrough }): React.JSX.Element {
    const currentIdx = trait.states.indexOf(trait.currentState);

    return (
        <VStack className={cn('p-3 rounded-container bg-card border border-border', className)} gap="sm" {...passthrough}>
            {trait.description && (
                <Typography variant="caption" className="text-muted-foreground">
                    {trait.description}
                </Typography>
            )}
            <HStack className="flex-wrap items-center" gap="xs">
                {trait.states.map((state, i) => {
                    const isDone = i < currentIdx;
                    const isCurrent = i === currentIdx;
                    return (
                        <React.Fragment key={state}>
                            {i > 0 && (
                                <Typography
                                    variant="caption"
                                    className={cn(
                                        'text-lg',
                                        isDone || isCurrent ? 'text-primary' : 'text-muted-foreground',
                                    )}
                                >
                                    {'\u2192'}
                                </Typography>
                            )}
                            <Box
                                display="inline-flex"
                                aria-current={isCurrent ? 'step' : undefined}
                                className={cn(
                                    'items-center justify-center rounded-pill px-3 py-1 border-heavy transition-all',
                                    SIZE_CONFIG[size || 'md'].fontSize,
                                    isDone && 'bg-success/20 border-success text-foreground',
                                    isCurrent && 'bg-primary/20 border-primary text-foreground font-bold shadow-elevation-card shadow-primary/20',
                                    !isDone && !isCurrent && 'bg-muted border-border text-muted-foreground',
                                )}
                            >
                                <Box as="span" className="mr-1">
                                    {isDone ? '\u2714' : isCurrent ? '\u25CF' : '\u25CB'}
                                </Box>
                                <Box as="span">{state}</Box>
                            </Box>
                        </React.Fragment>
                    );
                })}
            </HStack>
        </VStack>
    );
}

// =============================================================================
// Compact variant — current state + available transitions
// =============================================================================

function CompactView({
    trait,
    size = 'md',
    stateStyles,
    className,
    passthrough,
}: Pick<TraitStateViewerProps, 'trait' | 'size' | 'stateStyles' | 'className'> & { passthrough: DomPassthrough }): React.JSX.Element {
    const { t } = useTranslate();
    const config = SIZE_CONFIG[size || 'md'];
    const currentTransitions = trait.transitions.filter(t => t.from === trait.currentState);

    return (
        <VStack className={cn('p-3 rounded-container bg-card border border-border', className)} gap="sm" {...passthrough}>
            <HStack className="items-center justify-between">
                <Typography variant="body2" className="text-foreground font-bold">
                    {trait.name}
                </Typography>
                <StateIndicator state={trait.currentState} size="sm" stateStyles={stateStyles} />
            </HStack>

            {trait.description && (
                <Typography variant="caption" className="text-muted-foreground" overflow="wrap">
                    {trait.description}
                </Typography>
            )}

            {currentTransitions.length > 0 && (
                <VStack className="pt-2 border-t border-border" gap="xs">
                    <Typography variant="caption" className="text-muted-foreground">
                        {t('trait.availableActions') + ':'}
                    </Typography>
                    <HStack className="flex-wrap" gap="xs">
                        {currentTransitions.map((transition, i) => (
                            <Box
                                key={i}
                                display="inline-flex"
                                className={cn('items-center gap-1 px-2 py-1 rounded bg-muted', config.fontSize)}
                            >
                                <Typography variant="caption" className="text-foreground">{transition.event}</Typography>
                                <Typography variant="caption" className="text-muted-foreground">{'\u2192'}</Typography>
                                <Typography variant="caption" className="text-success">{transition.to}</Typography>
                                {transition.guardHint && (
                                    <Box as="span" className="text-warning ml-1 cursor-help" title={transition.guardHint}>
                                        <Typography variant="caption" className="text-warning">
                                            {'\u26A0'}
                                        </Typography>
                                    </Box>
                                )}
                            </Box>
                        ))}
                    </HStack>
                </VStack>
            )}
        </VStack>
    );
}

// =============================================================================
// Full variant — all states and transitions visible
// =============================================================================

function FullView({
    trait,
    size = 'md',
    showTransitions = true,
    onStateClick,
    stateStyles,
    className,
    passthrough,
}: Pick<TraitStateViewerProps, 'trait' | 'size' | 'showTransitions' | 'onStateClick' | 'stateStyles' | 'className'> & { passthrough: DomPassthrough }): React.JSX.Element {
    const { t } = useTranslate();
    const config = SIZE_CONFIG[size || 'md'];
    const currentTransitions = trait.transitions.filter(t => t.from === trait.currentState);

    return (
        <VStack className={cn('p-3 rounded-container bg-card border border-border', className)} gap="sm" {...passthrough}>
            {/* Header */}
            <HStack className="items-center justify-between">
                <Typography variant="body2" className="text-foreground font-bold">
                    {trait.name}
                </Typography>
                <StateIndicator state={trait.currentState} size="sm" stateStyles={stateStyles} />
            </HStack>

            {trait.description && (
                <Typography variant="caption" className="text-muted-foreground" overflow="wrap">
                    {trait.description}
                </Typography>
            )}

            {/* All state nodes */}
            <HStack className={cn('flex-wrap', config.gap)}>
                {trait.states.map((state) => {
                    const isCurrent = state === trait.currentState;
                    const hasOutgoing = trait.transitions.some(t => t.from === state);

                    return (
                        <Box
                            key={state}
                            display="flex"
                            aria-current={isCurrent ? 'true' : undefined}
                            className={cn(
                                'items-center justify-center rounded-container border-heavy transition-all px-2',
                                config.nodeSize,
                                isCurrent && 'bg-primary/20 border-primary shadow-elevation-card shadow-primary/20',
                                !isCurrent && hasOutgoing && 'bg-muted border-border hover:border-muted-foreground',
                                !isCurrent && !hasOutgoing && 'bg-background border-border opacity-60',
                                onStateClick && 'cursor-pointer',
                            )}
                            {...pressableProps(onStateClick ? () => onStateClick(state) : undefined)}
                        >
                            <Typography
                                variant="caption"
                                className={cn(
                                    config.fontSize,
                                    'whitespace-nowrap',
                                    isCurrent ? 'text-primary font-bold' : 'text-foreground',
                                )}
                            >
                                {state}
                            </Typography>
                        </Box>
                    );
                })}
            </HStack>

            {/* All transitions */}
            {showTransitions && (
                <VStack className="pt-2 border-t border-border" gap="xs">
                    <Typography variant="caption" className="text-muted-foreground">
                        {t('trait.transitions') + ':'}
                    </Typography>
                    <VStack gap="xs">
                        {trait.transitions.map((transition, i) => {
                            const isActive = transition.from === trait.currentState;
                            return (
                                <HStack
                                    key={i}
                                    className={cn(
                                        'items-center px-2 py-1 rounded text-xs',
                                        isActive ? 'bg-primary/10' : 'bg-muted/50',
                                    )}
                                    gap="xs"
                                >
                                    <Typography variant="caption" className={isActive ? 'text-primary font-medium' : 'text-muted-foreground'}>
                                        {transition.from}
                                    </Typography>
                                    <Typography variant="caption" className="text-muted-foreground">
                                        {'\u2014['}
                                    </Typography>
                                    <Typography variant="caption" className="text-foreground font-medium">
                                        {transition.event}
                                    </Typography>
                                    <Typography variant="caption" className="text-muted-foreground">
                                        {']\u2192'}
                                    </Typography>
                                    <Typography variant="caption" className={isActive ? 'text-success font-medium' : 'text-muted-foreground'}>
                                        {transition.to}
                                    </Typography>
                                    {transition.guardHint && (
                                        <Box as="span" className="text-warning ml-1 cursor-help" title={transition.guardHint}>
                                            <Typography variant="caption" className="text-warning">
                                                {'\u26A0 ' + transition.guardHint}
                                            </Typography>
                                        </Box>
                                    )}
                                </HStack>
                            );
                        })}
                    </VStack>
                </VStack>
            )}

            {/* Current state actions highlighted */}
            {showTransitions && currentTransitions.length > 0 && (
                <VStack className="pt-2 border-t border-border" gap="xs">
                    <Typography variant="caption" className="text-primary font-medium">
                        {t('trait.availableNow') + ':'}
                    </Typography>
                    <HStack className="flex-wrap" gap="xs">
                        {currentTransitions.map((t, i) => (
                            <Box
                                key={i}
                                display="inline-flex"
                                className="items-center gap-1 px-2 py-1 rounded bg-primary/10 border border-primary/30 text-xs"
                            >
                                <Typography variant="caption" className="text-foreground font-medium">{t.event}</Typography>
                                <Typography variant="caption" className="text-muted-foreground">{'\u2192'}</Typography>
                                <Typography variant="caption" className="text-success">{t.to}</Typography>
                            </Box>
                        ))}
                    </HStack>
                </VStack>
            )}
        </VStack>
    );
}

// =============================================================================
// Main component — dispatches to variant
// =============================================================================

export function TraitStateViewer({
    trait,
    variant = 'compact',
    size = 'md',
    showTransitions = true,
    onStateClick,
    stateStyles,
    className,
    ...rest
}: TraitStateViewerProps): React.JSX.Element {
    const passthrough = domPassthrough(rest);
    switch (variant) {
        case 'linear':
            return <LinearView trait={trait} size={size} className={className} passthrough={passthrough} />;
        case 'compact':
            return (
                <CompactView
                    trait={trait}
                    size={size}
                    stateStyles={stateStyles}
                    className={className}
                    passthrough={passthrough}
                />
            );
        case 'full':
            return (
                <FullView
                    trait={trait}
                    size={size}
                    showTransitions={showTransitions}
                    onStateClick={onStateClick}
                    stateStyles={stateStyles}
                    className={className}
                    passthrough={passthrough}
                />
            );
    }
}

TraitStateViewer.displayName = 'TraitStateViewer';

export default TraitStateViewer;
