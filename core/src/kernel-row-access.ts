/**
 * Row-level entity access on the kernel's one owner (`orbital-core` `entity_access`).
 *
 * An access directive is a per-row predicate evaluated with `@entity` bound to the candidate row (the incoming
 * data for `@create`) and `@user` bound to the viewer. A predicate that fails to evaluate drops the row or
 * denies the mutation. The hosts that still run a persistence adapter call these in place of an evaluator of
 * their own; the kernel decides.
 *
 * @packageDocumentation
 */

import { kernelEvaluator, toWireValue } from './kernel-evaluator';
import type { EvalContextWire, MutationOpWire } from './generated/kernel-wire';
import type { EntityRow, EventPayload, RowBindingResult, SExpr, TraitConfigObject } from './types/index';
import type { UserContext } from './types/user';

/** What every access check evaluates against. */
export interface AccessBindings {
  user?: UserContext;
  /** The dispatch's `now` stamp, so a time-based policy agrees with the dispatch's guards. */
  now?: number;
  payload?: EventPayload;
  /** The issuing trait's call-site config, so a policy or filter reading `@config.*` resolves it. */
  config?: TraitConfigObject;
}

/** The three directives checked against a row before it is written. */
export type MutationOp = MutationOpWire;

function accessContext(bindings: AccessBindings): EvalContextWire {
  return {
    ...(bindings.user !== undefined ? { user: toWireValue(bindings.user) } : {}),
    ...(bindings.now !== undefined ? { now: bindings.now } : {}),
    ...(bindings.payload !== undefined ? { payload: toWireValue(bindings.payload) } : {}),
    ...(bindings.config !== undefined ? { config: toWireValue(bindings.config) } : {}),
    state: 'idle',
  };
}

/**
 * The one denial message. Three enforcement paths produce it identically, because a consumer distinguishing
 * "denied" from "failed" reads this string.
 */
export function accessDeniedMessage(op: MutationOp, entityType: string): string {
  return `@${op} denied: the declared access policy for '${entityType}' rejected this row`;
}

/**
 * Retain only the rows BOTH the declared `@read` policy and the call-site `filter:` accept: the policy can only
 * narrow what the call site sees. A no-op when neither is declared.
 */
export function applyRowAccess<T extends EntityRow>(
  rows: T[],
  policy: SExpr | undefined,
  filter: SExpr | undefined,
  bindings: AccessBindings,
  entityType = '',
): T[] {
  return kernelEvaluator().scopeRows(accessContext(bindings), rows, policy, filter, entityType);
}

/**
 * Whether `row` may undergo `operation` under the declared directive: `row` is the incoming data for `create`, the
 * existing row for `update`/`delete`. No directive allows; a directive that fails to evaluate denies.
 */
export function checkMutationAccess(
  operation: MutationOp,
  row: EntityRow,
  policy: SExpr | undefined,
  bindings: AccessBindings,
  entityType = '',
): boolean {
  if (policy === undefined) return true;
  return kernelEvaluator().checkMutation(operation, accessContext(bindings), row, policy, entityType).allowed;
}

/** What the store push-down driver needs from the kernel (`RowAccess` in `@almadar/db/pushdown`), bound to one dispatch. */
export interface RowAccessBundle {
  resolve(term: string): RowBindingResult;
  mayWrite(row: EntityRow, policy: SExpr | undefined): boolean;
  scope<T extends EntityRow>(rows: T[], policy: SExpr | undefined, filter: SExpr | undefined): T[];
}

export function rowAccess(bindings: AccessBindings): RowAccessBundle {
  return {
    resolve: (term) => kernelEvaluator().resolveRowBinding(term, accessContext(bindings)),
    mayWrite: (row, policy) => checkMutationAccess('update', row, policy, bindings),
    scope: (rows, policy, filter) => applyRowAccess(rows, policy, filter, bindings),
  };
}
