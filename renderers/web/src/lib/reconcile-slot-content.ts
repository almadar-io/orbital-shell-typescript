'use client';
/**
 * reconcile-slot-content
 *
 * Structural sharing for the slot flush sink. A `render-ui` flush rebuilds
 * the descriptor tree every time (tick-rate flushes included), but
 * `deferEntityBindings` defers exactly the `@entity`-dependent leaves as
 * `RenderBindingMarker`s — so consecutive flushes of the same descriptor
 * are deep-identical (marker expressions are the SAME parsed-AST node
 * across flushes). Reconciling the incoming tree against the existing slot
 * entry lets unchanged subtrees keep their object identity: the WeakMap
 * presence caches behind `subtreeHasMarker` / `subtreeHasTraitRef` hit,
 * memoized renderers skip, and an all-equal flush bails the state write
 * entirely (no notify, no React cascade). See `R-SLOT-FLUSH-IDENTITY-CHURN`
 * in `docs/Almadar_Runtime_Gaps.md`.
 *
 * @packageDocumentation
 */

import React from 'react';
import { isRenderBindingMarker, type SExpr } from '@almadar/core';
import type { SlotProps, SlotPropValue } from '../providers/UISlotContext';

export interface ReconcileResult<T> {
  /** The tree to store: `prev` (identity preserved) wherever equal. */
  readonly value: T;
  /** True when prev and next are deep-equal — callers may bail entirely. */
  readonly equal: boolean;
}

/** Marker expressions: identity first (same parsed-AST node across flushes),
 *  structural fallback for re-parsed schemas. */
function expressionEqual(a: SExpr, b: SExpr): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!expressionEqual(a[i] as SExpr, b[i] as SExpr)) return false;
    }
    return true;
  }
  if (
    a !== null && b !== null &&
    typeof a === 'object' && typeof b === 'object' &&
    !Array.isArray(a) && !Array.isArray(b) &&
    !(a instanceof Date) && !(b instanceof Date)
  ) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!expressionEqual(
        (a as Record<string, SExpr>)[key],
        (b as Record<string, SExpr>)[key],
      )) return false;
    }
    return true;
  }
  return false;
}

function isPlainSlotObject(value: SlotPropValue): value is { readonly [key: string]: SlotPropValue } {
  if (value === null || value === undefined || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  if (React.isValidElement(value)) return false;
  if (value instanceof Date) return false;
  if (isRenderBindingMarker(value)) return false;
  return true;
}

function shareValue(prev: SlotPropValue, next: SlotPropValue): ReconcileResult<SlotPropValue> {
  if (Object.is(prev, next)) return { value: prev, equal: true };

  // Markers: equal iff their expressions are — the wrapper object is
  // re-minted per flush around the same AST node, so compare THROUGH it and
  // keep the previous wrapper's identity.
  const prevMarker = isRenderBindingMarker(prev) ? prev : undefined;
  const nextMarker = isRenderBindingMarker(next) ? next : undefined;
  if (prevMarker !== undefined || nextMarker !== undefined) {
    if (prevMarker !== undefined && nextMarker !== undefined && expressionEqual(prevMarker.expression, nextMarker.expression)) {
      return { value: prev, equal: true };
    }
    return { value: next, equal: false };
  }

  if (prev instanceof Date || next instanceof Date) {
    return prev instanceof Date && next instanceof Date && prev.getTime() === next.getTime()
      ? { value: prev, equal: true }
      : { value: next, equal: false };
  }

  // Functions, React elements, class instances: identity only (Object.is
  // above already covered equality) — never recurse into them.
  if (typeof prev === 'function' || typeof next === 'function') return { value: next, equal: false };
  if (React.isValidElement(prev) || React.isValidElement(next)) return { value: next, equal: false };

  if (Array.isArray(prev) && Array.isArray(next)) {
    let equal = prev.length === next.length;
    const out: SlotPropValue[] = new Array(next.length);
    for (let i = 0; i < next.length; i++) {
      const child = shareValue(prev[i] as SlotPropValue, next[i] as SlotPropValue);
      out[i] = child.value;
      if (!child.equal) equal = false;
    }
    return equal ? { value: prev, equal: true } : { value: out, equal: false };
  }

  if (isPlainSlotObject(prev) && isPlainSlotObject(next)) {
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    let equal = prevKeys.length === nextKeys.length;
    const out: Record<string, SlotPropValue> = {};
    for (const key of nextKeys) {
      if (!Object.prototype.hasOwnProperty.call(prev, key)) {
        equal = false;
        out[key] = next[key];
        continue;
      }
      const child = shareValue(prev[key], next[key]);
      out[key] = child.value;
      if (!child.equal) equal = false;
    }
    return equal ? { value: prev, equal: true } : { value: out, equal: false };
  }

  return { value: next, equal: false };
}

/**
 * Reconcile an incoming flush's props against the existing slot entry's
 * props. Equal subtrees keep the PREVIOUS object identity; a fully-equal
 * tree returns `equal: true` so the sink can skip the write entirely.
 */
export function reconcileSlotProps(prev: SlotProps | string, next: SlotProps | string): ReconcileResult<SlotProps | string> {
  // Bare-string payloads (`@trait.X` embeds) reconcile by equality. The two
  // typeof checks must be SEPARATE returns — a combined `||` guard leaves
  // both params un-narrowed in the fall-through.
  if (typeof prev === 'string') return { value: next, equal: prev === next };
  if (typeof next === 'string') return { value: next, equal: false };
  const result = shareValue(prev, next);
  // `shareValue`'s value type is the `SlotPropValue` superset (the recursive
  // walk descends into individual prop values); at THIS top level both operands
  // are whole props objects, so the reconciled value is `SlotProps` — same
  // boundary cast the file's own recursive array branch already uses.
  return { value: result.value as SlotProps, equal: result.equal };
}
