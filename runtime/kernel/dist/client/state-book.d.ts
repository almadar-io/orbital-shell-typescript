import { TraitDefinition, EventId } from '@almadar/core';
import { TransitionObserver, TraitState, RollbackCause } from './trait-types.js';
import '@almadar/core/kernel-wire';

/** The state a trait starts in: the one marked initial, else the first declared. */
declare function findInitialState(trait: TraitDefinition): string;
declare function createInitialTraitState(trait: TraitDefinition): TraitState;
/**
 * Every transition out of `currentState` on the event, in declaration order. An event id is compared with a
 * transition's own id when both carry one, so an arm still matches after its event was renamed.
 */
declare function findMatchingTransitions(trait: TraitDefinition, currentState: string, eventKey: string, eventId?: EventId): TraitDefinition['transitions'];
/** The first transition out of `currentState` on the event, ignoring guards. */
declare function findTransition(trait: TraitDefinition, currentState: string, eventKey: string, eventId?: EventId): TraitDefinition['transitions'][0] | undefined;
declare class StateBook {
    private readonly observer?;
    private readonly traits;
    private readonly states;
    constructor(traits?: readonly TraitDefinition[], observer?: TransitionObserver | undefined);
    /** The trait's state, its initial state until the kernel reports one; `undefined` for a trait not on the page. */
    getState(traitName: string, entityId?: string): TraitState | undefined;
    /** Each trait's singleton-scope state. */
    getAllStates(): Map<string, TraitState>;
    /** Whether the trait has an arm on the event from its current state. */
    canHandleEvent(traitName: string, eventKey: string, entityId?: string, eventId?: EventId): boolean;
    /**
     * The lifecycle event an embedded child can be repainted with: the one it handles from its current state,
     * provided every matching arm stays in that state and only renders.
     */
    repaintLifecycleEvent(traitName: string, entityId?: string): string | undefined;
    /** Record the state the kernel reports. No-op for a trait not on the page. */
    seedState(traitName: string, currentState: string, entityId?: string): void;
    /** Undo an optimistic commit, reporting the hop back to the observer. */
    rollbackState(traitName: string, toState: string, entityId: string | undefined, cause: RollbackCause): void;
}

export { StateBook, createInitialTraitState, findInitialState, findMatchingTransitions, findTransition };
