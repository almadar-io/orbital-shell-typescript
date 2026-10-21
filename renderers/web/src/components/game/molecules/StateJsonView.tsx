/**
 * StateJsonView Component
 *
 * Shows a state machine's definition as an expandable code block, so the learner
 * sees the declarative schema behind the visual graph. Dumb molecule: takes the
 * machine as plain typed fields (name/states/initialState/transitions) — the
 * .lolo organism owns the entity and the molecule renders + stringifies it.
 *
 * @packageDocumentation
 */

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../../core';
import React, { useState } from 'react';
import { VStack, HStack, Box, Typography, Button } from '../../../core';
import { cn } from '../../../core';
import { useTranslate } from '../../../core';

export interface StateJsonTransition {
    from: string;
    to: string;
    /** Deliberately NOT `EventKey`: these are JSON.stringify'd into a code
     *  block for display. This component has no event bus and cannot emit;
     *  tagging `transitions` as an `event-list` would police the PLAYER's
     *  invented vocabulary against the orbital's event set. */
    event: string;
}

export interface StateJsonViewProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
    /** Machine name */
    name: string;
    /** Initial state */
    initialState: string;
    /** All state names */
    states: string[];
    /** The player's wired transitions */
    transitions: StateJsonTransition[];
    /** Header label */
    label?: string;
    /** Whether the code block is expanded by default */
    defaultExpanded?: boolean;
    /** Additional CSS classes */
    className?: string;
}

export function StateJsonView({
    name,
    initialState,
    states,
    transitions,
    label,
    defaultExpanded = false,
    className,
    ...rest
}: StateJsonViewProps): React.JSX.Element {
    const { t } = useTranslate();
    const [expanded, setExpanded] = useState(defaultExpanded);
    const jsonString = JSON.stringify(
        { name, initialState, states: states ?? [], transitions: transitions ?? [] },
        null,
        2,
    );

    return (
        <VStack {...domPassthrough(rest)} className={cn('rounded-container border border-border overflow-hidden', className)} gap="none">
            <HStack className="items-center justify-between p-2 bg-muted" gap="sm">
                <Typography variant="caption" className="text-muted-foreground font-medium">
                    {label ?? t('stateArchitect.viewCode')}
                </Typography>
                <Button variant="ghost" onClick={() => setExpanded(!expanded)} className="text-xs">
                    {expanded ? t('stateArchitect.hideJson') : t('stateArchitect.showJson')}
                </Button>
            </HStack>
            {expanded && (
                <Box className="p-3 bg-background overflow-x-auto">
                    <Typography
                        variant="caption"
                        className="text-foreground font-mono whitespace-pre text-xs leading-relaxed block"
                    >
                        {jsonString}
                    </Typography>
                </Box>
            )}
        </VStack>
    );
}

StateJsonView.displayName = 'StateJsonView';

export default StateJsonView;
