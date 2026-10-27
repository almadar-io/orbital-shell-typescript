/**
 * useSlotFlush — W5b (docs/Almadar_Runtime_Stateless_Stateful_PLAN.md §5.1).
 *
 * Kernel-outcome client effects → UI slots, including a bare `@trait.X`
 * string payload (G-RUNTIME-025) and `navigate`/`navigate-back`. Replaces
 * the old hook's inline `flushSlot` AND `OrbPreview`'s two copy-pasted
 * effect-tuple walkers (`applyServerEffects`'s local-path duplicate) — one
 * owner for "how does a `ClientEffectTuple` become a slot write."
 *
 * Two entry points:
 * - `flushSlot` — a GROUPED per-(trait, slot) pattern list, for a caller
 *   that already has one (`useClientTicks`, `useCallsiteCapture`, and the
 *   composer's own per-dispatch flush of `ClientKernelOutcome.response`).
 * - `applyClientEffects` — the per-trait `clientEffectsByTrait` list
 *   `OrbitalEventResponse` itself carries; used directly for every kernel
 *   dispatch outcome.
 *
 * @packageDocumentation
 */
import { useRowSetResolverHandle } from '../../providers/RowSetResolverContext';
import { notifyRowsChanged } from '../../lib/rows-changed';
import { useCallback, useMemo, useRef } from 'react';
import type { ClientEffectByTrait, EventPayload, PatternNode } from '@almadar/core';
import { isNotificationSlot } from '../../lib/slot-definitions';
import { createLogger } from '@almadar/logger';
import { convertFnFormLambdasInProps } from '../../lib/fn-form-lambda';
import type { SlotPatternEntry, SlotSource } from '../../types/slot-types';
import type { useUISlots, SlotProps } from '../../providers/UISlotContext';

const flushLog = createLogger('almadar:ui:circuit:slot-flush');

export interface FlushSlotSource {
  event?: string;
  state?: string;
  entity?: string;
}

/** What the flush last wrote for one (slot, trait): a slot render or an embedded trait frame. */
type WrittenSlot =
  | { kind: 'render'; config: Parameters<ReturnType<typeof useUISlots>['render']>[0] }
  | { kind: 'trait'; trait: string; content: Parameters<ReturnType<typeof useUISlots>['updateTraitContent']>[1] }
  | { kind: 'clear'; slot: string; trait: string };

/** Opaque point-in-time record of every (slot, trait) write, for `rollback`. */
export type SlotCheckpoint = ReadonlyMap<string, WrittenSlot>;

export interface SlotFlushHandle {
  /** Snapshot of what the flush has written so far (synchronous — no React state lag). */
  checkpoint: () => SlotCheckpoint;
  /**
   * Undo every write made since `checkpoint`: re-apply what each (slot, trait)
   * held then, or clear it when it held nothing. Used when a locally-painted
   * dispatch's server leg fails.
   */
  rollback: (checkpoint: SlotCheckpoint) => void;
  flushSlot: (traitName: string, slot: string, patterns: SlotPatternEntry[], source?: FlushSlotSource) => void;
  applyClientEffects: (
    clientEffectsByTrait: ReadonlyArray<ClientEffectByTrait> | undefined,
    onNavigate?: (path: string, params?: Record<string, string>, crumb?: string) => void,
    onNavigateBack?: () => void,
    activeTraits?: ReadonlySet<string>,
  ) => void;
}

function unwrapPattern(record: PatternNode | string | null): { bareTraitRef?: string; props?: SlotProps; patternType?: string } {
  if (typeof record === 'string') return { bareTraitRef: record };
  if (record === null) return {};
  const { type, children, ...inlineProps } = record as PatternNode;
  const props = { ...(inlineProps as SlotProps), ...(children !== undefined ? { children } : {}) };
  return { patternType: type as string | undefined, props };
}

export function useSlotFlush(
  uiSlots: ReturnType<typeof useUISlots>,
  embeddedTraits: ReadonlySet<string> | undefined,
): SlotFlushHandle {
  const uiSlotsRef = useRef(uiSlots);
  uiSlotsRef.current = uiSlots;
  const rowSets = useRowSetResolverHandle();
  const rowSetsRef = useRef(rowSets);
  rowSetsRef.current = rowSets;
  const embeddedTraitsRef = useRef(embeddedTraits);
  embeddedTraitsRef.current = embeddedTraits;
  const writtenRef = useRef(new Map<string, WrittenSlot>());
  const keyOf = (slot: string, trait: string): string => `${slot}\u0000${trait}`;

  const flushSlot = useCallback((
    traitName: string,
    slot: string,
    patterns: SlotPatternEntry[],
    source?: FlushSlotSource,
  ): void => {
    const slots = uiSlotsRef.current;
    const embedded = embeddedTraitsRef.current;
    if (patterns.length === 0) {
      flushLog.debug('clear', { traitName, slot });
      slots.clearBySource(slot as Parameters<typeof slots.clearBySource>[0], traitName);
      writtenRef.current.set(keyOf(slot, traitName), { kind: 'clear', slot, trait: traitName });
      return;
    }
    const last = patterns[patterns.length - 1];
    const { bareTraitRef, patternType, props: unwrapped } = unwrapPattern(last.pattern as PatternNode | string | null);
    const rawProps: SlotProps | string = bareTraitRef !== undefined
      ? bareTraitRef
      : { ...(unwrapped ?? {}), ...(last.props as SlotProps) };
    const props = convertFnFormLambdasInProps(rawProps, typeof patternType === "string" ? patternType : undefined);
    // An embedded trait's frame holds its inline renders; a portal slot
    // (toast, modal, drawer, …) renders in that slot like any trait's.
    const isEmbedded = (embedded?.has(traitName) ?? false) && !isNotificationSlot(slot);
    if (isEmbedded) {
      const content = {
        pattern: patternType as string,
        props,
        slot,
        priority: 0,
        transitionEvent: source?.event,
        fromState: source?.state,
        entity: source?.entity,
      };
      slots.updateTraitContent(traitName, content);
      writtenRef.current.set(keyOf(slot, traitName), { kind: 'trait', trait: traitName, content });
      return;
    }
    const config = {
      target: slot as Parameters<typeof slots.render>[0]['target'],
      pattern: patternType as string,
      props,
      sourceTrait: traitName,
      transitionEvent: source?.event,
      fromState: source?.state,
      entity: source?.entity,
    };
    slots.render(config);
    writtenRef.current.set(keyOf(slot, traitName), { kind: 'render', config });
  }, []);

  const applyClientEffects = useCallback((
    clientEffectsByTrait: ReadonlyArray<ClientEffectByTrait> | undefined,
    onNavigate?: (path: string, params?: Record<string, string>, crumb?: string) => void,
    onNavigateBack?: () => void,
    /**
     * Traits mounted on THIS page (`useCircuitKernel`'s restricted
     * `TraitIndex`). `applyOrbitalEventResponse`'s fold returns
     * `clientEffectsByTrait` verbatim off the server's
     * response with no page filter of its own (a REAL multi-page stateful
     * server initializes every trait it holds, not just this page's) — this
     * is the client-side half of that scoping (Gap #11's "orbital-granular
     * over-execution": drop an off-page trait's render effect for parity
     * with the local path, which never mounted it). A tagged effect with no
     * `activeTraits` given (or no `traitName`) is never filtered.
     */
    activeTraits?: ReadonlySet<string>,
  ): void => {
    const slots = uiSlotsRef.current;
    const embedded = embeddedTraitsRef.current;
    for (const { effect, traitName, event, fromState, repaint } of clientEffectsByTrait ?? []) {
      if (traitName !== undefined && activeTraits !== undefined && !activeTraits.has(traitName)) continue;
      const kind = effect[0];
      if (kind === 'render-ui') {
        const [, slot, pattern] = effect;
        const sourceTrait = traitName ?? 'kernel';
        const { bareTraitRef, patternType, props: unwrapped } = unwrapPattern(pattern as PatternNode | null);
        const isEmbedded = (embedded?.has(sourceTrait) ?? false) && !isNotificationSlot(slot);
        const propsValue: SlotProps | string = bareTraitRef !== undefined
          ? bareTraitRef
          : { ...(unwrapped ?? {}) };
        const props = convertFnFormLambdasInProps(propsValue, typeof patternType === "string" ? patternType : undefined);
        if (pattern === null) {
          slots.clearBySource(slot as Parameters<typeof slots.clearBySource>[0], sourceTrait);
          writtenRef.current.set(keyOf(slot, sourceTrait), { kind: 'clear', slot, trait: sourceTrait });
        } else if (isEmbedded) {
          const content = { pattern: patternType as string, props, slot, priority: 0, transitionEvent: event, fromState };
          slots.updateTraitContent(sourceTrait, content);
          writtenRef.current.set(keyOf(slot, sourceTrait), { kind: 'trait', trait: sourceTrait, content });
        } else {
          const config = { target: slot as Parameters<typeof slots.render>[0]['target'], pattern: patternType as string, props, sourceTrait, transitionEvent: event, fromState };
          slots.render(config);
          writtenRef.current.set(keyOf(slot, sourceTrait), { kind: 'render', config });
        }
        if (repaint === 'rows-changed') notifyRowsChanged(rowSetsRef.current, props);
      } else if (kind === 'navigate') {
        const [, route, params, options] = effect;
        onNavigate?.(route, params ?? undefined, options?.crumb);
      } else if (kind === 'navigate-back') {
        onNavigateBack?.();
      }
    }
  }, []);

  // The handle object must be identity-stable: `useTraitStateMachine`'s
  // dispatchAndSettle deps on it, and the mount-lifecycle INIT effect deps on
  // dispatchAndSettle — a fresh object per render refires INIT forever
  // (INIT → fetch → notify → re-render → refire storm, verified live
  // 2026-09-23 via init:lifecycle-storm instrumentation).
  const checkpoint = useCallback((): SlotCheckpoint => new Map(writtenRef.current), []);

  const rollback = useCallback((cp: SlotCheckpoint): void => {
    const slots = uiSlotsRef.current;
    for (const [key, now] of writtenRef.current) {
      const then = cp.get(key);
      if (then === now) continue;
      if (then === undefined || then.kind === 'clear') {
        if (now.kind === 'render') slots.clearBySource(now.config.target, now.config.sourceTrait ?? 'kernel');
        else if (now.kind === 'trait') {
          // An embedded frame that held nothing before has no clear API; the
          // trait's next render replaces it.
          flushLog.warn('rollback:embedded-frame-kept', { trait: now.trait });
        }
      } else if (then.kind === 'render') {
        slots.render(then.config);
      } else {
        slots.updateTraitContent(then.trait, then.content);
      }
    }
    writtenRef.current = new Map(cp);
  }, []);

  return useMemo(() => ({ flushSlot, applyClientEffects, checkpoint, rollback }), [flushSlot, applyClientEffects, checkpoint, rollback]);
}

export type { SlotSource, EventPayload };
