/**
 * StateGraph (molecule)
 *
 * A player-built state machine drawn by the AVL state-machine renderer. All
 * state (which transitions exist, the pending "from" selection, test results)
 * lives in the .lolo FSM — this molecule only renders and reports clicks.
 */
import * as React from 'react';
import { Box } from '../../../core';
import { cn } from '../../../core';
import type { A11yProps, EventEmit } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { AvlStateMachine } from '../../avl/molecules/AvlStateMachine';
import type { TraitLevelData } from '../../../lib/avl-schema-parser';

export interface StateGraphTransition {
    from: string;
    to: string;
    /** Deliberately NOT `EventKey`: this is a drawn arrow's caption, not a bus
     *  event. Typing it `EventKey` would tag `transitions` as an `event-list`
     *  and validate the PLAYER's invented state-machine vocabulary against the
     *  orbital's event set. The real bus outlet here is `nodeClickEvent`. */
    event: string;
    guardHint?: string;
}

export interface StateGraphProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
    /** All states in the machine (node labels). */
    states: string[];
    /** Player-built transitions rendered as arrows. */
    transitions?: StateGraphTransition[];
    /** State highlighted as current (test playback / initial). */
    currentState?: string;
    /** State the player has selected (first click). */
    selectedState?: string;
    /** When set, the graph is in "pick a target" mode from this state. */
    addingFrom?: string;
    /** The machine's initial state (ring-marked). */
    initialState?: string;
    /** Graph canvas width. */
    width?: number;
    /** Graph canvas height. */
    height?: number;
    /** Emits UI:{nodeClickEvent} with { stateId } when a node is clicked. */
    nodeClickEvent?: EventEmit<{ stateId: string }>;
    className?: string;
}

export function StateGraph({
    states,
    transitions = [],
    currentState,
    selectedState,
    addingFrom,
    initialState,
    width = 500,
    height = 400,
    nodeClickEvent,
    className,
    ...rest
}: StateGraphProps): React.JSX.Element {
    const trait = React.useMemo<TraitLevelData>(() => ({
        name: 'StateGraph',
        linkedEntity: '',
        states: (states ?? []).map((name) => ({ name, isInitial: name === initialState, isTerminal: false })),
        transitions: transitions.map((tr, index) => ({
            from: tr.from,
            to: tr.to,
            event: tr.event,
            guard: tr.guardHint ?? null,
            effects: [],
            index,
        })),
        emittedEvents: [],
        listenedEvents: [],
    }), [states, transitions, initialState]);

    return (
        <Box
            {...domPassthrough(rest)}
            position="relative"
            className={cn('rounded-container border border-border bg-background overflow-auto p-2', className)}
            style={{ width, height }}
        >
            <AvlStateMachine
                trait={trait}
                activeState={currentState || undefined}
                selectedState={selectedState || undefined}
                pendingSourceState={addingFrom || undefined}
                stateClickEvent={nodeClickEvent}
                showHeader={false}
            />
        </Box>
    );
}
