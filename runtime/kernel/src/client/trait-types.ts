/**
 * The client host's view of a trait: its running state, its flat definition, and the observer a
 * verifier hangs on committed hops. Client-host types, not language contract.
 */
import type { SExpr, TraitConfig } from '@almadar/core';
import type { HopObservation } from '@almadar/core/kernel-wire';

/**
 * State of a single trait's state machine
 */
export interface TraitState {
    /** Trait name */
    traitName: string;
    /** Current state name */
    currentState: string;
    /** Previous state (null if initial) */
    previousState: string | null;
    /** Last event that caused a transition */
    lastEvent: string | null;
    /** Custom context data */
    context: TraitConfig;
}

/**
 * Observer interface for recording transition and effect traces.
 * Implement this to wire in the verificationRegistry or other monitoring tools.
 *
 * The runtime calls these hooks automatically when transitions execute and
 * effects complete, enabling runtime verification without tight coupling.
 */
export interface TransitionObserver {
    /**
     * Called after a transition is processed (whether or not it executed).
     */
    onTransition(trace: {
        traitName: string;
        from: string;
        to: string;
        event: string;
        /** The arm that fired, by its position among the state's arms for the event. */
        firedArm?: number;
        guardResult?: boolean;
        effects: Array<{
            type: string;
            args: SExpr[];
            status: "executed" | "failed" | "skipped";
            error?: string;
            durationMs?: number;
        }>;
        /** Recorded for a verifier only (`setRecordEntityAfter`): the payload and `@entity` before and after. */
        observed?: HopObservation;
    }): void;
    /**
     * Called when an optimistic dispatch is undone: the state moved back from
     * `from` to `to` because the server rejected the leg or never answered.
     */
    onRollback?(trace: { traitName: string; from: string; to: string; cause: RollbackCause }): void;
}

/** Why an optimistic dispatch was rolled back. */
export type RollbackCause = 'transport-error' | 'server-rejected';
