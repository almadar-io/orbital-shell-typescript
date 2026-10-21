/**
 * Per-transition slot pattern types — shared by `useTraitStateMachine`
 * (the state-machine accumulator) and any consumer that wants to look at
 * the raw pattern + props pair before unwrap.
 *
 * Pre-consolidation these lived in `SlotsContext.tsx` together with a
 * React Provider that maintained a parallel `slots` store. That store
 * was removed in favor of consolidating onto `useUISlots`, so only the
 * structural types remain here.
 *
 * @packageDocumentation
 */

import type { PatternConfig, EventSource, ResolvedTrait, FieldValue, SExpr, ResolvedPatternProps } from '@almadar/core';
import type { SlotPropValue } from '../hooks/useUISlots';
import { createLogger } from '@almadar/logger';

/**
 * Slot-render observability channel. Used by `useTraitStateMachine`,
 * `OrbPreview.applyServerEffects`, and the `<SlotContentRenderer>` to
 * surface every slot write/clear at debug level. Pre-consolidation
 * lived in `SlotsContext.tsx`; consolidated here so consumers don't
 * depend on the now-removed React provider.
 */
export const slotLog = createLogger('almadar:ui:slot-render');

const refIds = new WeakMap<object, number>();
let nextRefId = 1;

/**
 * Stable per-object id used by slot-render logs to compare entity
 * references across renders (e.g. spotting the form-reset bug where
 * the same logical row arrives with a fresh ref id every transition).
 */
export function refId(obj: SlotPropValue | null | undefined): number | null {
  if (obj === null || obj === undefined || typeof obj !== 'object') return null;
  const existing = refIds.get(obj as object);
  if (existing !== undefined) return existing;
  const id = nextRefId++;
  refIds.set(obj as object, id);
  return id;
}

/**
 * One pattern within a slot's accumulated render-ui set, plus any
 * caller-supplied props that should be merged on top.
 */
export interface SlotPatternEntry {
  /** `PatternConfig` normally; a bare `@trait.X` string is the
   *  G-RUNTIME-025 whole-slot payload (`(render-ui main "@trait.X")`),
   *  which `useSlotFlush`'s unwrap routes as a TraitFrame child reference. */
  pattern: PatternConfig | string;
  props: ResolvedPatternProps;
}

/**
 * The originating trait + state for a slot write. Embedded in the
 * `useUISlots` SlotContent's metadata so observers (verifier, debugger,
 * cross-orbital tracer) can attribute every render to the trait that
 * caused it.
 */
export interface SlotSource extends EventSource {
  trait: string;
  state: string;
  transition: string;
  effects: SExpr[];
  traitDefinition: ResolvedTrait;
}
