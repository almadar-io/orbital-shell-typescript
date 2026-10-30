/** A trait's flat definition: the shape the circuit store keeps its initial state from. */
import type { EventId, TraitId } from './identity.js';
import type { SExpr } from './expression.js';
import type { TraitEventListener } from './trait.js';

/** Minimal trait definition for state machine processing. */
export interface TraitDefinition {
    /** V4 dual-carry id sibling of `name` — the stable state-machine lookup
     *  key when present (ledger-backed). Absent → keyed by name (legacy). */
    id?: TraitId;
    name: string;
    states: Array<{ name: string; isInitial?: boolean }>;
    transitions: Array<{
        from: string | string[];
        to: string;
        event: string;
        /** V4 dual-carry id sibling of `event` — optional until the Phase-7 flip. */
        eventId?: EventId;
        guard?: SExpr;
        effects?: SExpr[];
        /** Compensating transition when effects fail (RCG-04) */
        onEffectError?: {
            to: string;
            effects?: SExpr[];
        };
    }>;
    /** Cross-trait event listeners (optional). */
    listens?: TraitEventListener[];
}
