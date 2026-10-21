/**
 * Per-row condition on a list action item.
 *
 * `.lolo` authors it on the action item itself:
 *
 * ```lolo
 * itemActions: [{ event: EDIT, label: Edit, when: (fn row (= (object/get @row ownerId) @user.id)) }]
 * ```
 *
 * The lambda arrives as the S-expression `["fn", "row", body]` on BOTH
 * execution paths (the interpreter delivers it raw through the slot content;
 * the compiled shell emits it as the item's data), so this is the only
 * evaluator: every list component asks `isActionShownForRow` / `actionsShownForRow`
 * (via `useRowActions`) instead of carrying its own copy. An action with no
 * `when` is always shown. This is the explicit per-row rule; it is never
 * derived from anything else and composes with the `roles` filter.
 *
 * @packageDocumentation
 */

import type { EntityRow, EventPayload, SExpr, TraitConfig, UserContext } from '@almadar/core';
import { ANONYMOUS_USER, isEventPayloadValue, toWireValue } from '@almadar/core';
import type { EvalContextWire } from '@almadar/core/kernel-wire';
import { createLogger } from '@almadar/logger';
import { evaluateBinding, evaluateBindings } from '../core';

const whenLog = createLogger('almadar:ui:row-action-when');

/** The declared action-item member that carries the row condition. */
export const ACTION_WHEN_KEY = 'when';

/**
 * What an action item's `when` holds. The interpreter delivers the authored
 * `(fn row …)` S-expression; the compiled shell lowers the same lambda to a
 * `(row) => boolean` closure over the ambient viewer. Both are accepted here,
 * evaluated by the one helper below.
 */
export type RowActionCondition = SExpr | ((row: EntityRow) => boolean);

/**
 * What an action item's `payload` holds: the authored `(fn row { key: <expr> })`
 * S-expression, or the compiled shell's `(row) => payload` closure.
 */
export type RowActionPayload = SExpr | ((row: EntityRow) => EventPayload);

/** An action item that may carry a per-row condition and a declared payload. */
export interface RowConditionalAction {
  readonly when?: RowActionCondition;
  readonly payload?: RowActionPayload;
}

/** What a `when` body may read besides `@row`: the viewer, and host-supplied `@entity` / `@config`. */
export interface RowActionBindings {
  /** The signed-in viewer; null/absent binds `@user` as the anonymous viewer. */
  readonly user?: UserContext | null;
  readonly entity?: EntityRow;
  readonly config?: TraitConfig;
}

function lambdaParts(when: SExpr): { param: string; body: SExpr } | null {
  if (!Array.isArray(when) || when.length !== 3 || when[0] !== 'fn') return null;
  const params = when[1];
  const param = typeof params === 'string' ? params : Array.isArray(params) && params.length === 1 ? params[0] : null;
  if (typeof param !== 'string' || param.length === 0) return null;
  return { param: param.startsWith('@') ? param.slice(1) : param, body: when[2] as SExpr };
}

function contextFor(row: EntityRow, param: string, bindings: RowActionBindings): EvalContextWire {
  return {
    entity: toWireValue(bindings.entity ?? {}),
    user: toWireValue(bindings.user ?? ANONYMOUS_USER),
    ...(bindings.config !== undefined ? { config: toWireValue(bindings.config) } : {}),
    state: 'idle',
    locals: { [param]: toWireValue(row) },
  };
}

/**
 * The event payload `action` sends for `row`: `{ id, row }` plus every key its
 * declared `payload` computes (a declared key wins). A malformed or throwing
 * payload is logged and the action still sends `{ id, row }`.
 */
export function rowActionPayload<A extends RowConditionalAction>(
  action: A,
  row: EntityRow,
  bindings: RowActionBindings,
): EventPayload {
  const base: EventPayload = { id: row.id, row };
  const declared = action.payload;
  if (declared === undefined) return base;
  try {
    if (typeof declared === 'function') return { ...base, ...declared(row) };
    const lambda = lambdaParts(declared);
    if (lambda === null) {
      whenLog.warn('malformed-payload', { payload: JSON.stringify(declared) });
      return base;
    }
    const ctx = contextFor(row, lambda.param, bindings);
    const body: SExpr = lambda.body;
    const out: EventPayload = { ...base };
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
      // `(fn row { key: <expr>, … })` — each value is an expression or a literal.
      const entries = Object.entries(body);
      const values = evaluateBindings(ctx, entries.map(([, expr]) => expr));
      entries.forEach(([key], i) => {
        const value = values[i];
        if (isEventPayloadValue(value)) out[key] = value;
      });
      return out;
    }
    const value = evaluateBinding(ctx, body);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, v] of Object.entries(value)) {
        if (isEventPayloadValue(v)) out[key] = v;
      }
    }
    return out;
  } catch (error) {
    whenLog.warn('payload-threw', { message: error instanceof Error ? error.message : String(error) });
    return base;
  }
}

/**
 * Is `action` drawn for `row`? True when it has no `when`, otherwise only when
 * the lambda returns boolean `true`. A malformed or throwing `when` hides the
 * action (an unreadable rule never widens access) and is logged.
 */
export function isActionShownForRow(
  action: RowConditionalAction,
  row: EntityRow,
  bindings: RowActionBindings,
): boolean {
  const when = action.when;
  if (when === undefined) return true;
  if (typeof when === 'function') {
    try {
      return when(row) === true;
    } catch (error) {
      whenLog.warn('when-threw', { message: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
  const lambda = lambdaParts(when);
  if (lambda === null) {
    whenLog.warn('malformed-when', { when: JSON.stringify(when) });
    return false;
  }
  try {
    return evaluateBinding(contextFor(row, lambda.param, bindings), lambda.body) === true;
  } catch (error) {
    whenLog.warn('when-threw', { message: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * The subset of `actions` drawn for `row`, in order. Returns the SAME array
 * when no action carries a `when`, so memoised consumers keep their identity.
 */
export function actionsShownForRow<A extends RowConditionalAction>(
  actions: readonly A[],
  row: EntityRow,
  bindings: RowActionBindings,
): readonly A[] {
  if (!actions.some((a) => a.when !== undefined)) return actions;
  return actions.filter((a) => isActionShownForRow(a, row, bindings));
}
