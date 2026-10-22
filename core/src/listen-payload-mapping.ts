/**
 * Listen-route payload mapping — the `with { field: <expr> }` clause.
 *
 * A `listens` entry's `payloadMapping` is `{ targetField: SExpr }` (see
 * `TraitEventListener.payloadMapping`). Applying it rewrites the SOURCE trait's
 * outgoing payload into the shape the LOCAL trigger expects before the internal
 * event dispatches. ONE contract, shared by every delivery path: the server
 * runtime (`OrbitalServerRuntime`) and the client cross-trait wiring
 * (`@almadar/ui` useTraitStateMachine).
 *
 * Every value is a full s-expression evaluated against the source payload —
 * `?field` renames, but also `(object/get ?request "accepted")`, `(str/concat …)`,
 * object and array literals. This mirrors `orbital-core`'s listener fan-out
 * (`runtime/listener.rs:126-136`, `runtime/kernel.rs:696-707`), which evaluates
 * each mapping value through the canonical `Evaluator` with a payload-only
 * binding context.
 *
 * The evaluator is injected rather than imported: `@almadar/core` sits upstream
 * of `@almadar/evaluator`, so the caller — which already holds one — supplies it.
 *
 * @packageDocumentation
 */

import { isEventPayloadValue } from './types/expression.js';
import type { EventPayload, SExpr } from './types/index';
import type { RuntimeValue } from './types/json.js';

/**
 * Evaluates one `with{}` mapping value against the source event payload.
 *
 * The context MUST bind the payload only, matching the Rust listener's
 * `BindingContextBuilder::new().payload(…).build()`. Binding `@entity` or
 * `@config` here would let a mapping resolve on the JS path and silently
 * yield nothing on the compiled one.
 */
export type ListenPayloadEvaluator = (expr: SExpr, payload: EventPayload) => RuntimeValue;

/**
 * Apply a listen entry's `payloadMapping` to the source event payload.
 *
 * - No mapping, or no payload → the payload passes through unchanged.
 * - Otherwise the mapping REPLACES the payload: only mapped keys survive.
 * - `"@payload.<field>"` reads that field; a bare string is a literal; an
 *   operator list is evaluated. All three are just `evaluate`.
 * - A key whose expression throws, or whose result cannot travel in a payload,
 *   is dropped — parity with `runtime/listener.rs`, where a failed evaluation
 *   skips the insert rather than delivering a hole.
 */
export function applyListenPayloadMapping(
    payloadMapping: Record<string, SExpr> | undefined,
    payload: EventPayload | undefined,
    evaluate: ListenPayloadEvaluator,
): EventPayload | undefined {
    if (!payloadMapping || !payload) return payload;
    const mapped: EventPayload = {};
    for (const [key, expr] of Object.entries(payloadMapping)) {
        let value: RuntimeValue;
        try {
            value = evaluate(expr, payload);
        } catch {
            continue;
        }
        if (isEventPayloadValue(value)) mapped[key] = value;
    }
    return mapped;
}
