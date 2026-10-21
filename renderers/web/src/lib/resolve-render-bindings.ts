'use client';
/**
 * resolve-render-bindings
 *
 * Render-time evaluation of `RenderBindingMarker` prop leaves
 * (`$renderBinding`, `@almadar/core`). A render lambda's body defers its
 * `@entity`- and i18n-dependent leaves as markers (`fn-form-lambda`);
 * SlotContentRenderer resolves them here, on the kernel's evaluator, against
 * the owning trait's live entity snapshot on every React render.
 *
 * Scoping rule: a subtree carrying its own `_sourceTrait` (multi-source
 * slot stack children, see `aggregateSlot` in useUISlots) is left raw so
 * the child's own SlotContentRenderer resolves it against ITS trait's
 * bindings — the synthetic stack wrapper has no entity of its own.
 * Everything else in one pattern's props belongs to the pattern's source
 * trait and resolves with that trait's context.
 *
 * @packageDocumentation
 */

import React from 'react';
import { isRenderBindingMarker, isRowSetMarker, KernelEvalError, kernelEvaluator, toWireValue, type EntityRow, type RowSetMarker, type SExpr, type TraitConfig } from '@almadar/core';
import type { RowSetResolver } from './row-set-resolver';
import { getComponentForPattern } from '@almadar/core/patterns';
import type { SlotProps, SlotPropValue } from '../providers/UISlotContext';
import type { RenderI18n } from '../core';

/** Resolve one marker on the kernel against the trait's live bindings. */
function resolveMarkerExpression(
  expression: SExpr,
  entity: EntityRow,
  config: TraitConfig | undefined,
  state: string,
  i18n: RenderI18n | undefined,
): SlotPropValue {
  const [outcome] = kernelEvaluator().resolveValues({
    entity: toWireValue(entity),
    payload: {},
    state,
    ...(config !== undefined ? { config: toWireValue(config) } : {}),
    ...(i18n !== undefined ? { locale: i18n.locale, messages: i18n.messages } : {}),
  }, [toWireValue(expression)]);
  if (outcome.kind === 'error') throw new KernelEvalError(outcome.message);
  return outcome.value;
}

function isPlainObject(value: SlotPropValue): value is { readonly [key: string]: SlotPropValue } {
  if (value === null || value === undefined || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  if (React.isValidElement(value)) return false;
  if (value instanceof Date) return false;
  if (typeof value === 'function') return false;
  return true;
}

// Slot content is replaced only by a flush, so a container's identity is a
// valid cache key for "does this subtree hold any marker". Tick-driven boards
// re-resolve on every entity change (30Hz+); without this the walk pays full
// tree size per render even though only the marker leaves can change.
const markerPresenceCache = new WeakMap<object, boolean>();

// Marker resolution is pure in (marker expression, entity snapshot, config,
// state), and the flush sink's structural sharing keeps marker object
// identity stable across re-flushes — so memoize per marker object keyed on
// the input identities: the slot-level walk and the nested
// SlotContentRenderer walk resolve the same marker ONCE per entity commit.
// A resolved marker always differs from the marker itself, so a hit still
// rebuilds its container; container identity is kept by
// `containerResolutionCache` below, never by returning the raw input.
interface MarkerResolution {
  entity: EntityRow;
  config: TraitConfig | undefined;
  state: string;
  i18n: RenderI18n | undefined;
  resolved: SlotPropValue;
}
const markerResolutionCache = new WeakMap<object, MarkerResolution>();

// A marker-bearing container's resolved copy, per the same inputs: repeat
// renders with an unchanged entity/config/state get the SAME resolved
// object, so downstream memos and identity caches keep hitting.
interface ContainerResolution {
  entity: EntityRow;
  config: TraitConfig | undefined;
  state: string;
  i18n: RenderI18n | undefined;
  scopeTrait: string | undefined;
  rowSets: RowSetResolver | undefined;
  rowSetEpoch: number;
  resolved: SlotPropValue;
}
const containerResolutionCache = new WeakMap<object, ContainerResolution>();

function cachedContainer(
  value: object,
  scopeTrait: string | undefined,
  entity: EntityRow,
  config: TraitConfig | undefined,
  state: string,
  i18n: RenderI18n | undefined,
  rowSets: RowSetResolver | undefined,
): SlotPropValue | undefined {
  const hit = containerResolutionCache.get(value);
  return hit !== undefined && hit.entity === entity && hit.config === config && hit.state === state && hit.i18n === i18n && hit.scopeTrait === scopeTrait
    && hit.rowSets === rowSets && hit.rowSetEpoch === (rowSets?.epoch() ?? 0)
    ? hit.resolved
    : undefined;
}

// Certified marker-free containers. The slot-level walk deep-resolves the
// whole tree, then every nested SlotContentRenderer re-runs
// `resolveRenderBindingMarkers` on ITS slice — the slice's containers are
// the parent's freshly-rebuilt objects, so the identity presence cache can
// never hit and the walk re-scans the full depth per commit per renderer.
// Branding every container the walk returns (marker-free by construction:
// unchanged = certified by the presence scan, rebuilt = markers just
// resolved) makes the nested re-walks O(1). Foreign `_sourceTrait`
// subtrees are NEVER branded — their own renderer must still resolve the
// markers they carry.
const resolvedMarkerFree = new WeakSet<object>();

// Direct outputs of marker evaluation are evaluator-produced DATA — unless
// they are render nodes (an `if`/`array/map` choosing authored patterns),
// which can carry a config-forwarded `@trait.X` child. The trait-ref
// substitution scan (`subtreeHasTraitRef` in UISlotRenderer) skips branded
// data containers instead of re-walking e.g. a 400-point canvas array every commit.
const evaluatorResolvedData = new WeakSet<object>();

/** A registered pattern node, as `isPatternConfig` in UISlotRenderer reads one. */
function isPatternNode(value: SlotPropValue): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || React.isValidElement(value) || value instanceof Date) return false;
  const type = (value as Record<string, SlotPropValue>).type;
  return typeof type === 'string' && getComponentForPattern(type) !== null;
}

function holdsRenderNode(value: SlotPropValue): boolean {
  return isPatternNode(value) || (Array.isArray(value) && value.some((item) => isPatternNode(item as SlotPropValue)));
}

/** True for containers produced by marker evaluation (runtime data). */
export function isEvaluatorResolvedData(value: object): boolean {
  return evaluatorResolvedData.has(value);
}

function brandResolved(value: SlotPropValue): void {
  if (value !== null && typeof value === 'object' && !React.isValidElement(value) && !(value instanceof Date)) {
    resolvedMarkerFree.add(value as object);
  }
}

/** A row-set reference held directly as a prop that the resolver has not answered yet. */
function holdsUnresolvedRowSet(props: object, rowSets: RowSetResolver | undefined): boolean {
  if (rowSets === undefined) return false;
  return Object.values(props).some((item) => isRowSetMarker(item as SlotPropValue) && rowSets.resolve((item as RowSetMarker).ref).loading);
}

function subtreeHasMarker(value: object): boolean {
  if (resolvedMarkerFree.has(value)) return false;
  const cached = markerPresenceCache.get(value);
  if (cached !== undefined) return cached;
  let found = false;
  const children: readonly SlotPropValue[] = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, SlotPropValue>);
  for (const child of children) {
    if (isRenderBindingMarker(child) || isRowSetMarker(child)) { found = true; break; }
    if (Array.isArray(child) || isPlainObject(child)) {
      if (subtreeHasMarker(child)) { found = true; break; }
    }
  }
  markerPresenceCache.set(value, found);
  return found;
}

function walkValue(
  value: SlotPropValue,
  scopeTrait: string | undefined,
  entity: EntityRow,
  config: TraitConfig | undefined,
  state: string,
  i18n: RenderI18n | undefined,
  rowSets: RowSetResolver | undefined,
): { resolved: SlotPropValue; changed: boolean } {
  if (isRowSetMarker(value)) {
    // A row set resolves through the one resolver; without one the leaf stays raw (nothing can answer it).
    if (rowSets === undefined) return { resolved: value, changed: false };
    return { resolved: rowSets.resolve(value.ref).rows as SlotPropValue, changed: true };
  }
  if (isRenderBindingMarker(value)) {
    const cached = markerResolutionCache.get(value);
    if (cached !== undefined && cached.entity === entity && cached.config === config && cached.state === state && cached.i18n === i18n) {
      return { resolved: cached.resolved, changed: true };
    }
    const resolved = resolveMarkerExpression(value.expression, entity, config, state, i18n);
    markerResolutionCache.set(value, { entity, config, state, i18n, resolved });
    // Evaluator output is data: brand it so both the marker scan and the
    // trait-ref scan skip it (see the WeakSet notes above).
    if (resolved !== null && typeof resolved === 'object' && !React.isValidElement(resolved) && !(resolved instanceof Date)) {
      resolvedMarkerFree.add(resolved as object);
      if (!holdsRenderNode(resolved)) evaluatorResolvedData.add(resolved as object);
    }
    return { resolved, changed: true };
  }
  if (Array.isArray(value)) {
    if (!subtreeHasMarker(value)) {
      brandResolved(value);
      return { resolved: value as SlotPropValue, changed: false };
    }
    const cachedArray = cachedContainer(value, scopeTrait, entity, config, state, i18n, rowSets);
    if (cachedArray !== undefined) return { resolved: cachedArray, changed: true };
    // A marker in array position may evaluate to an array itself (an
    // `array/map` children expression) — splice it flat so consumers keep
    // receiving plain node lists.
    const out: SlotPropValue[] = [];
    let changed = false;
    for (const item of value) {
      const element = item as SlotPropValue;
      const wasMarker = isRenderBindingMarker(element);
      const { resolved, changed: itemChanged } = walkValue(element, scopeTrait, entity, config, state, i18n, rowSets);
      if (wasMarker && Array.isArray(resolved)) {
        out.push(...(resolved as SlotPropValue[]));
        changed = true;
        continue;
      }
      out.push(resolved);
      if (itemChanged) changed = true;
    }
    brandResolved(out);
    if (!changed) return { resolved: value as SlotPropValue, changed: false };
    containerResolutionCache.set(value, { entity, config, state, i18n, scopeTrait, rowSets, rowSetEpoch: rowSets?.epoch() ?? 0, resolved: out as SlotPropValue });
    return { resolved: out as SlotPropValue, changed: true };
  }
  if (isPlainObject(value)) {
    if (!subtreeHasMarker(value)) {
      brandResolved(value);
      return { resolved: value as SlotPropValue, changed: false };
    }
    // Foreign-scoped subtree (multi-source stack child) — its own
    // SlotContentRenderer resolves it against its trait's bindings. Never
    // branded: it still carries markers for that renderer.
    const sourceTrait = (value as { _sourceTrait?: SlotPropValue })._sourceTrait;
    if (typeof sourceTrait === 'string' && sourceTrait !== scopeTrait) {
      return { resolved: value as SlotPropValue, changed: false };
    }
    const cachedObject = cachedContainer(value, scopeTrait, entity, config, state, i18n, rowSets);
    if (cachedObject !== undefined) return { resolved: cachedObject, changed: true };
    const out: Record<string, SlotPropValue> = {};
    let changed = false;
    for (const [key, item] of Object.entries(value)) {
      const { resolved, changed: itemChanged } = walkValue(item as SlotPropValue, scopeTrait, entity, config, state, i18n, rowSets);
      out[key] = resolved;
      if (itemChanged) changed = true;
    }
    // A pattern whose rows are still in flight shows its own loading state, never an empty table.
    if (holdsUnresolvedRowSet(value, rowSets)) {
      out.isLoading = true;
      changed = true;
    }
    brandResolved(out as SlotPropValue);
    if (!changed) return { resolved: value as SlotPropValue, changed: false };
    containerResolutionCache.set(value, { entity, config, state, i18n, scopeTrait, rowSets, rowSetEpoch: rowSets?.epoch() ?? 0, resolved: out as SlotPropValue });
    return { resolved: out as SlotPropValue, changed: true };
  }
  return { resolved: value, changed: false };
}

/**
 * Resolve every `RenderBindingMarker` in a pattern's props against the
 * source trait's live bindings. Identity-preserving: with no markers the
 * ORIGINAL `props` reference is returned, so memoized downstream consumers
 * (and Form's normalizedInitialData contract) see a stable identity
 * whenever the entity snapshot did not change.
 */
export function resolveRenderBindingMarkers(
  props: SlotProps | string,
  scopeTrait: string | undefined,
  entity: EntityRow,
  config: TraitConfig | undefined,
  state: string,
  i18n?: RenderI18n,
  rowSets?: RowSetResolver,
): SlotProps | string {
  // A bare-string slot payload (`(render-ui main "@trait.X")`) is not a
  // props object — `Object.entries` on a string would explode it into
  // indexed characters. Primitives pass through untouched; the renderer
  // lifts the `@trait.X` string to a TraitFrame. This guard runs BEFORE the
  // brand check: the brand set is keyed on objects only.
  if (props === null || typeof props !== 'object') return props;
  // Already resolved by an enclosing walk (the slot-level renderer resolves
  // the whole tree; nested SlotContentRenderers re-enter per pattern) — the
  // brand certifies marker-free, so re-walking would only re-scan.
  if (resolvedMarkerFree.has(props)) return props;
  const cached = cachedContainer(props, scopeTrait, entity, config, state, i18n, rowSets);
  if (cached !== undefined) return cached as SlotProps;
  const out: Record<string, SlotPropValue> = {};
  let changed = false;
  for (const [key, value] of Object.entries(props)) {
    const { resolved, changed: propChanged } = walkValue(value, scopeTrait, entity, config, state, i18n, rowSets);
    out[key] = resolved;
    if (propChanged) changed = true;
  }
  if (holdsUnresolvedRowSet(props, rowSets)) {
    out.isLoading = true;
    changed = true;
  }
  brandResolved(out as SlotProps);
  if (!changed) return props;
  containerResolutionCache.set(props, { entity, config, state, i18n, scopeTrait, rowSets, rowSetEpoch: rowSets?.epoch() ?? 0, resolved: out as SlotPropValue });
  return out as SlotProps;
}
