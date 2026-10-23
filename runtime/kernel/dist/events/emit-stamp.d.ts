import { OrbitalId, TraitId, EventId, BusEventSource } from '@almadar/core';

/**
 * emit-stamp — the ONE emit-source stamper.
 *
 * Extracted from `OrbitalServerRuntime.executeEffects`'s emit handler so
 * every execution path (stateful server, stateless per-request, any future
 * emitter) stamps emitted events identically. G-RUNTIME-030 was exactly
 * this decision existing twice with different outcomes: a stamp missing
 * the V4 `traitId`/`orbitalId`/`eventId` triple silently never matches an
 * id-scoped `listens` matcher (`buildSourceMatcher`), and the fan-out dies
 * without an error.
 *
 * All four ids are optional dual-carry: absent → name-only stamp (legacy,
 * name-keyed routing), present → id-keyed routing via `eventRouteKey`.
 *
 * @packageDocumentation
 */

interface StampEmitIdentity {
    /** The dispatching orbital's declared name (name-stamp fallback). */
    orbitalName: string;
    /** The emitting trait's declared name (name-stamp fallback). */
    traitName: string;
    /** V4 ids, when the schema carries them. */
    orbitalId?: OrbitalId;
    traitId?: TraitId;
    /**
     * The emitting trait's `emits[]` contract entry id for THIS event — the
     * single canonical event id (mirrors `resolveSourceEmitEventId` on the
     * listen side; the listener's own declared id can be stale, the emit
     * contract's is what the emitter actually stamps).
     */
    emitContractEventId?: EventId;
    /** The originating tab's client id, when this emit is client-driven. */
    originClientId?: string;
}
/**
 * Fill a bus-event source stamp with the V4 identity triple + origin.
 * Mutates and returns `source` when given (handlers pass their closure
 * source through); otherwise synthesizes one from the lexical identity.
 * Never overwrites a field already set on the stamp.
 */
declare function stampEmitSource(source: BusEventSource | undefined, identity: StampEmitIdentity): BusEventSource;

export { type StampEmitIdentity, stampEmitSource };
