'use client';
/**
 * useUISlots Hook
 *
 * Core hook for managing UI slot rendering in the trait-driven architecture.
 * Traits use render_ui effects to dynamically render content into slots.
 *
 * Slots:
 * - main: Primary content area
 * - sidebar: Left/right sidebar
 * - modal: Modal overlay
 * - drawer: Slide-in drawer
 * - overlay: Full-screen overlay
 * - center: Centered popup
 * - toast: Toast notifications
 * - hud-top: Game HUD top bar
 * - hud-bottom: Game HUD bottom bar
 * - floating: Draggable floating panel
 *
 * Multi-source model (2026-04-24):
 * A slot can receive renders from multiple source traits across independent
 * batches (e.g. in the playground, ProbeCreate renders "main" on INIT, then
 * later ProbePersistor cascades a render into "main" too). Prior code stored
 * a single SlotContent per slot and last-writer-wins silently dropped
 * earlier traits' frames. Internally the manager now holds a
 * `Record<UISlot, Record<sourceKey, SlotContent>>` map and consumers see an
 * aggregated view: a single SlotContent for single-source slots, or a
 * synthetic `stack` wrapper when 2+ sources are active simultaneously.
 * This mirrors the compiled-path page layout's VStack-of-trait-views.
 *
 * @packageDocumentation
 */

import type React from 'react';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { isNotificationSlot } from '../lib/slot-definitions';
import { RENDERED_SLOTS } from '@almadar/core';
import type { EventPayloadValue, RenderItemLambda, RowSetMarker, UISlot } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import { reconcileSlotProps } from '../lib/reconcile-slot-content';

// Slot lifecycle diagnostic. Records every render-write + clear so a
// missing log means the slot manager never saw the call (the bug is
// upstream); a present log means the bug is downstream of the slot
// store (DOM / React reconciliation / TraitFrame subscriber).
const log = createLogger('almadar:ui:ui-slots');

// ============================================================================
// Types
// ============================================================================

export type { UISlot };

/**
 * Render-prop callback after fn-form-lambda conversion or
 * `wrapCallbackForEvent` wrapping. Pattern components consume these as
 * `renderItem` / `onTabChange` / `onClick` / etc. The arg list is
 * contravariant (`never[]` accepts any caller shape — event handlers,
 * 2-arg `(item, index)` render-props, etc.); the return is the union of
 * shapes seen at this layer. Pattern-level prop types narrow the
 * signature for each consumer downstream.
 */
export type SlotCallback = (...args: never[]) => void | React.ReactNode | EventPayloadValue;

/**
 * Render-ui prop value: any leaf flowing from a `(render-ui slot {...})`
 * effect into a React pattern component. The union enumerates every
 * shape the renderer can receive — no `unknown` escape hatch.
 *
 * - JSON primitives (`string`, `number`, `boolean`, `Date`, `null`,
 *   `undefined`) come through `BindingResolver`.
 * - `RenderItemLambda` is the unconverted tuple form `["fn", arg, body]`;
 *   `SlotCallback` is the post-conversion callable form.
 * - `React.ReactNode` covers substituted `<TraitFrame>` elements.
 * - The recursive array + object branches mirror the `EventPayloadValue`
 *   shape but with `SlotPropValue` leaves so functions and React nodes
 *   can appear at any depth (e.g. `tabs[].content: "@trait.X"` surviving
 *   substitution into a `ReactElement`).
 */
export type SlotPropValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | RenderItemLambda
  | SlotCallback
  | React.ReactElement
  | RowSetMarker
  | ReadonlyArray<SlotPropValue>
  | { readonly [key: string]: SlotPropValue };

/**
 * Pattern-specific props carried by a rendered slot. The slot manager
 * routes these from `(render-ui slot {...})` effects to React pattern
 * components without coercion.
 */
export type SlotProps = Record<string, SlotPropValue>;

/**
 * Content rendered in a slot
 */
export interface SlotContent {
  /** Unique ID for this content */
  id: string;
  /** Pattern/component type to render */
  pattern: string;
  /** Props to pass to the pattern component. A bare string is a whole-slot
   * trait-embed reference (`(render-ui main "@trait.X")`) — the renderer lifts
   * it to a TraitFrame. */
  props: SlotProps | string;
  /** Priority for conflict resolution (higher wins) */
  priority: number;
  /** Auto-dismiss timestamp (for toasts) */
  autoDismissAt?: number;
  /** Callback when dismissed */
  onDismiss?: () => void;
  /** Source trait that rendered this content */
  sourceTrait?: string;
  /** Stable node ID from the schema pattern tree (for edit mode overlay targeting) */
  nodeId?: string;
  /** Slot this content was rendered into (= SlotRenderConfig.target) — contextual-edit address. */
  slot?: string;
  /** Transition event key that produced this render (raw, as fired). */
  transitionEvent?: string;
  /** State the trait was in when this render fired (the from-state). */
  fromState?: string;
  /** linkedEntity of the source trait — contextual-edit address. */
  entity?: string;
}

/**
 * Configuration for render_ui effect
 */
export interface SlotRenderConfig {
  /** Target slot */
  target: UISlot;
  /** Pattern/component to render */
  pattern: string;
  /** Props for the pattern — or a bare `@trait.X` embed string */
  props?: SlotProps | string;
  /** Priority (default: 0) */
  priority?: number;
  /** Auto-dismiss after ms (for toasts) */
  autoDismissMs?: number;
  /** Callback on dismiss */
  onDismiss?: () => void;
  /** Source trait name */
  sourceTrait?: string;
  /** Transition event key that produced this render (raw, as fired). */
  transitionEvent?: string;
  /** State the trait was in when this render fired (the from-state). */
  fromState?: string;
  /** linkedEntity of the source trait. */
  entity?: string;
}

/**
 * Callback for slot changes
 */
export type SlotChangeCallback = (slot: UISlot, content: SlotContent | null) => void;

/**
 * Fires when a specific trait's current render-ui output changes.
 * Used by `<TraitFrame>` to subscribe only to the trait it embeds,
 * avoiding wide re-renders when unrelated slots update.
 *
 * Per-trait index stores exactly one entry per trait (the most recent
 * render), so the callback signature carries just the new content —
 * no per-slot disambiguation needed.
 */
export type TraitChangeCallback = (content: SlotContent | null) => void;

/**
 * UI Slot Manager interface
 */
export interface UISlotManager {
  /**
   * Current aggregate content for each slot. Single-source slots hold
   * that source's SlotContent; multi-source slots hold a synthetic
   * `stack` wrapper whose `children` prop is the list of per-source
   * pattern configs in insertion order. Single consumers can continue
   * to read `slots[slot]` without knowing the slot is multi-source.
   */
  slots: Partial<Record<UISlot, SlotContent | null>>;
  /** Render content to a slot */
  render: (config: SlotRenderConfig) => string;
  /** Clear all source entries from a slot */
  clear: (slot: UISlot) => void;
  /** Clear a single source's contribution from a slot, keeping others */
  clearBySource: (slot: UISlot, sourceTrait: string) => void;
  /** Clear content by ID */
  clearById: (id: string) => void;
  /** Clear all slots */
  clearAll: () => void;
  /** Subscribe to slot changes */
  subscribe: (callback: SlotChangeCallback) => () => void;
  /** Check if a slot has content */
  hasContent: (slot: UISlot) => boolean;
  /** Get aggregated content for a slot (single or synthetic stack) */
  getContent: (slot: UISlot) => SlotContent | null;
  /**
   * Look up the most recent `render-ui` output a given trait produced,
   * keyed by `SlotContent.sourceTrait`. Returns `null` when the trait
   * hasn't rendered yet.
   *
   * Backs the `@trait.X` binding's client-side resolution via
   * `<TraitFrame>`. See `docs/Almadar_Std_Gaps.md` §3.8. The binding is
   * single-segment — there's intentionally no slot disambiguation.
   */
  getTraitContent: (traitName: string) => SlotContent | null;
  /**
   * Subscribe to changes in a specific trait's render output. Returns
   * an unsubscribe function.
   *
   * Scoped per-trait so `<TraitFrame>` components only re-render when
   * the trait they embed actually changes — not on every slot update.
   */
  subscribeTrait: (traitName: string, callback: TraitChangeCallback) => () => void;
  /**
   * Update only the per-trait sidecar without writing to any slot.
   *
   * Used for embed-aware slot routing: when a trait is referenced via
   * `@trait.X` by a sibling layout's render-ui, its render output should
   * not stack into the same slot the layout writes — the layout owns the
   * slot and embeds the trait's frame via `<TraitFrame>`. This method
   * keeps the per-trait sidecar (`traitIndexRef`) up-to-date so
   * `<TraitFrame>` re-renders, while leaving `slots[target]` untouched.
   *
   * Mirrors what the compiled-path codegen does structurally — atoms
   * inlined as JSX inside the layout's pattern, not writing slots.
   */
  updateTraitContent: (traitName: string, content: Omit<SlotContent, 'id' | 'sourceTrait'>) => string;
}

/** Per-source slot entry map: key = sourceTrait (or sentinel when none). */
type SlotSources = Record<string, SlotContent>;

/** Sentinel source key for renders that arrive without a `sourceTrait`. */
const DEFAULT_SOURCE_KEY = '__default__';

/** Sentinel source-trait name on the synthetic stack wrapper. */
const MULTI_SOURCE_STACK_TRAIT = '__multi_source_stack__';

// ============================================================================
// Default Slots State
// ============================================================================

// Core's RENDERED_SLOTS: the one list every renderer and verifier shares.
export const ALL_SLOTS: readonly UISlot[] = RENDERED_SLOTS;

const DEFAULT_SLOTS: Partial<Record<UISlot, SlotContent | null>> = ALL_SLOTS.reduce(
  (acc, slot) => {
    acc[slot] = null;
    return acc;
  },
  {} as Partial<Record<UISlot, SlotContent | null>>,
);

const DEFAULT_SOURCES: Partial<Record<UISlot, SlotSources>> = ALL_SLOTS.reduce(
  (acc, slot) => {
    acc[slot] = {};
    return acc;
  },
  {} as Partial<Record<UISlot, SlotSources>>,
);

// ============================================================================
// ID Generator
// ============================================================================

// ============================================================================
// Aggregation
// ============================================================================

/**
 * Collapse a slot's per-source SlotContent map into a single SlotContent
 * that the renderer can consume. Sources iterate in insertion order
 * (Object.keys preserves string-key insertion order in modern runtimes),
 * which matches the `.lolo` page-level trait declaration order.
 *
 * - 0 sources → null (empty slot).
 * - 1 source → that SlotContent verbatim.
 * - 2+ sources → synthetic `stack` wrapper whose children are the
 *   pattern configs of each source in order.
 */
function aggregateSlot(sources: SlotSources | undefined): SlotContent | null {
  if (!sources) return null;
  const entries = Object.entries(sources);
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0][1];

  // Multi-source: build a stack wrapper. Each child carries its own
  // `_sourceTrait` sidecar (same convention as `_id`) because the wrapper
  // itself has no single owner: the synthetic stack's `sourceTrait` is the
  // sentinel below, so a renderer that scoped by the wrapper alone would
  // give every stacked trait's subtree NO trait scope at all — and then a
  // bare `UI:X` emit from an affordance inside it can never be qualified to
  // its owning trait's key, so the click reaches nothing. The compiled path
  // has no equivalent hazard: codegen emits `<TraitScopeProvider>` lexically
  // around each trait's own markup, so scope is structural there. This keeps
  // the two paths in agreement (see R-SLOT-MULTI-SOURCE-STACK-DROPS-TRAIT-SCOPE).
  const children = entries.map(([sourceKey, entry]) =>
    // A bare-string payload (`(render-ui main "@trait.X")`) is kept as the
    // raw string child — the children walker lifts `@trait.X` strings to
    // TraitFrames — spreading it would explode it into indexed characters.
    typeof entry.props === 'string'
      ? entry.props
      : {
          type: entry.pattern,
          ...entry.props,
          ...(sourceKey !== DEFAULT_SOURCE_KEY && { _sourceTrait: sourceKey }),
        },
  );
  log.info('aggregateSlot:multi-source', {
    writers: entries.map(([k]) => k).join(','),
    patterns: entries.map(([, e]) => e.pattern).join(','),
  });
  const stackId = `slot-content-stack-${entries.map(([k]) => k).join('-')}`;
  return {
    id: stackId,
    pattern: 'stack',
    props: {
      direction: 'vertical',
      gap: 'lg',
      children,
    },
    priority: 0,
    sourceTrait: MULTI_SOURCE_STACK_TRAIT,
  };
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Create a UI Slot Manager instance.
 *
 * This is the internal hook that creates the manager.
 * Use `useUISlots()` from context in components.
 */
export function useUISlotManager(): UISlotManager {
  // Canonical state: per-slot, per-source SlotContent. Everything else
  // (the exposed `slots` aggregate map, trait reverse index, etc.) is
  // derived from this.
  const [sources, setSources] = useState<Partial<Record<UISlot, SlotSources>>>(DEFAULT_SOURCES);
  const subscribersRef = useRef<Set<SlotChangeCallback>>(new Set());
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Reverse index: traitName → most-recent SlotContent. Built
  // opportunistically from `SlotContent.sourceTrait` as each `render()`
  // fires. Per-trait, not per-trait-per-slot — the `@trait.X` binding is
  // single-segment (no `.slot` suffix), so consumers only need the
  // trait's last-emitted frame regardless of which slot it targeted.
  const traitIndexRef = useRef<Map<string, SlotContent>>(new Map());
  const traitSubscribersRef = useRef<Map<string, Set<TraitChangeCallback>>>(new Map());

  // Computed aggregate `slots` — memoised so React consumers only see
  // identity changes when a slot's actual content changes.
  const slots = useMemo<Partial<Record<UISlot, SlotContent | null>>>(() => {
    const out: Partial<Record<UISlot, SlotContent | null>> = { ...DEFAULT_SLOTS };
    for (const slot of ALL_SLOTS) {
      out[slot] = aggregateSlot(sources[slot]);
    }
    return out;
  }, [sources]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  // Notify subscribers of slot changes
  const notifySubscribers = useCallback((slot: UISlot, content: SlotContent | null) => {
    subscribersRef.current.forEach((callback) => {
      try {
        callback(slot, content);
      } catch (error) {
        log.error('Subscriber error', { error: error instanceof Error ? error : String(error) });
      }
    });
  }, []);

  // Fire trait-scoped subscriptions when a specific trait's output
  // changes (either because it rendered something new, or its content
  // was cleared). Safe against subscriber errors so one bad consumer
  // doesn't silence the rest.
  const notifyTraitSubscribers = useCallback(
    (traitName: string, content: SlotContent | null) => {
      const subs = traitSubscribersRef.current.get(traitName);
      if (!subs) return;
      subs.forEach((callback) => {
        try {
          callback(content);
        } catch (error) {
          log.error('Trait subscriber error', { traitName, error: error instanceof Error ? error : String(error) });
        }
      });
    },
    [],
  );

  // Single-entry per trait. A new render for a trait replaces the
  // previous entry regardless of slot — consumers only see the most
  // recent frame.
  const indexTraitRender = useCallback(
    (traitName: string, content: SlotContent) => {
      traitIndexRef.current.set(traitName, content);
    },
    [],
  );

  // Drop a trait's entry entirely (called when the underlying slot
  // content is cleared).
  const unindexTrait = useCallback((traitName: string) => {
    traitIndexRef.current.delete(traitName);
  }, []);

  // Render content to a slot
  const render = useCallback(
    (config: SlotRenderConfig): string => {
      const sourceKey = config.sourceTrait ?? DEFAULT_SOURCE_KEY;
      // STABLE, deterministic React identity for "this trait's render into this slot".
      // Re-emitting the SAME trait's `render-ui` into the SAME slot (e.g. every 100ms from
      // an `animTick`, or repeatedly from any source) yields the SAME `id`, so the renderer's
      // child keys (`childId = `${content.id}-${index}`` in UISlotRenderer) stay stable and
      // React RECONCILES the existing slot subtree — feeding it the new props — instead of
      // unmounting + remounting it. Minting a fresh counter+timestamp id per emission here is
      // what made EVERY ticking behavior remount its slot subtree every tick (GAP-R1: the
      // canvas/HUD flicker). This is pattern-agnostic — it holds for any slot + any pattern.
      const id = `slot-content-${config.target}-${sourceKey}`;
      const content: SlotContent = {
        id,
        pattern: config.pattern,
        props: config.props ?? {},
        priority: config.priority ?? 0,
        onDismiss: config.onDismiss,
        sourceTrait: config.sourceTrait,
        slot: config.target,
        transitionEvent: config.transitionEvent,
        fromState: config.fromState,
        entity: config.entity,
      };

      // Set auto-dismiss timer if specified
      if (config.autoDismissMs && config.autoDismissMs > 0) {
        content.autoDismissAt = Date.now() + config.autoDismissMs;
        // The id is now stable per slot+source, so a re-emission reuses this timer key —
        // clear any prior timer first so re-rendering RESETS the dismiss window instead of
        // leaking a stale timer.
        const prevTimer = timersRef.current.get(id);
        if (prevTimer) clearTimeout(prevTimer);
        const timer = setTimeout(() => {
          setSources((prev) => {
            const slotSources = prev[config.target];
            // Match by content-object IDENTITY, not id: with a stable id, only the EXACT
            // content this timer was created for should auto-dismiss — a newer re-emission
            // replaces the object (same id) and must NOT be dismissed by this old timer.
            if (slotSources && slotSources[sourceKey] === content) {
              content.onDismiss?.();
              const next = { ...slotSources };
              delete next[sourceKey];
              const updated = { ...prev, [config.target]: next };
              notifySubscribers(config.target, aggregateSlot(next));
              return updated;
            }
            return prev;
          });
          timersRef.current.delete(id);
        }, config.autoDismissMs);
        timersRef.current.set(id, timer);
      }

      setSources((prev) => {
        const slotSources = prev[config.target] ?? {};
        const existing = slotSources[sourceKey];

        // Priority-based conflict resolution within the same source.
        // Cross-source renders coexist; within a single source, a higher-
        // priority content wins over a newer lower-priority content.
        if (existing && existing.priority > content.priority) {
          log.warn('Slot already has higher priority content', {
            slot: config.target,
            sourceKey,
            existingPriority: existing.priority,
            newPriority: content.priority,
          });
          return prev;
        }

        // Structural sharing (R-SLOT-FLUSH-IDENTITY-CHURN): a tick-rate
        // re-flush of the same descriptor rebuilds the whole props tree but
        // changes nothing — `@entity` leaves arrive as markers whose
        // expression is the same parsed-AST node every flush. Reconcile and
        // reuse the existing identities; when NOTHING changed, bail the
        // write entirely so no subscriber notifies and no React reconcile
        // runs. Auto-dismiss content is excluded: bailing would strand the
        // freshly-reset timer on a content object that was never stored.
        if (
          existing &&
          existing.priority === content.priority &&
          existing.pattern === content.pattern &&
          existing.transitionEvent === content.transitionEvent &&
          existing.fromState === content.fromState &&
          existing.entity === content.entity &&
          existing.nodeId === content.nodeId &&
          existing.autoDismissAt === undefined && content.autoDismissAt === undefined &&
          (existing.onDismiss === undefined) === (content.onDismiss === undefined)
        ) {
          const reconciled = reconcileSlotProps(existing.props, content.props);
          if (reconciled.equal) {
            log.debug('slot:flush-bail', { slot: config.target, sourceKey, pattern: content.pattern });
            return prev;
          }
          content.props = reconciled.value;
        }

        const nextSources: SlotSources = {
          ...slotSources,
          [sourceKey]: content,
        };
        const nextAll = { ...prev, [config.target]: nextSources };

        // Contention onset: this write makes a second live writer for the slot.
        // Almost always an unclaimed main-writer — detect, never arbitrate.
        const priorWriters = Object.keys(slotSources);
        if (priorWriters.length === 1 && priorWriters[0] !== sourceKey) {
          log.warn('slot:contention', {
            slot: config.target,
            writers: [priorWriters[0], sourceKey],
            patternTypes: [slotSources[priorWriters[0]].pattern, content.pattern],
          });
        }

        // Maintain the trait-scoped reverse index + notify per-trait
        // subscribers. The index holds a trait's INLINE presentation (what
        // its TraitFrame shows); a portal-slot render (toast, modal, …) is
        // an overlay and leaves it as it was.
        if (content.sourceTrait && !isNotificationSlot(config.target)) {
          indexTraitRender(content.sourceTrait, content);
          notifyTraitSubscribers(content.sourceTrait, content);
        }

        log.info('slot:written', {
          slot: config.target,
          sourceKey,
          sourceTrait: content.sourceTrait,
          patternType: content.pattern,
          priority: content.priority,
        });

        notifySubscribers(config.target, aggregateSlot(nextSources));
        return nextAll;
      });

      return id;
    },
    [notifySubscribers, notifyTraitSubscribers, indexTraitRender],
  );

  // Clear a specific slot — wipes all source entries.
  const clear = useCallback(
    (slot: UISlot) => {
      setSources((prev) => {
        const slotSources = prev[slot];
        if (!slotSources || Object.keys(slotSources).length === 0) {
          return prev;
        }
        // Fire onDismiss + trait cleanups for every source in the slot.
        for (const content of Object.values(slotSources)) {
          const timer = timersRef.current.get(content.id);
          if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(content.id);
          }
          content.onDismiss?.();
          if (content.sourceTrait && !isNotificationSlot(slot)) {
            unindexTrait(content.sourceTrait);
            notifyTraitSubscribers(content.sourceTrait, null);
          }
        }
        notifySubscribers(slot, null);
        return { ...prev, [slot]: {} };
      });
    },
    [notifySubscribers, notifyTraitSubscribers, unindexTrait],
  );

  // Clear a single source's contribution from a slot.
  const clearBySource = useCallback(
    (slot: UISlot, sourceTrait: string) => {
      const sourceKey = sourceTrait;
      setSources((prev) => {
        const slotSources = prev[slot];
        if (!slotSources || !(sourceKey in slotSources)) {
          // An embedded trait paints only its sidecar (`updateTraitContent`): a null there clears it too.
          const embedded = traitIndexRef.current.get(sourceTrait);
          if (embedded !== undefined && embedded.slot === slot) {
            unindexTrait(sourceTrait);
            notifyTraitSubscribers(sourceTrait, null);
            log.info('slot:cleared-embedded', { slot, sourceTrait, lastPatternType: embedded.pattern });
            return prev;
          }
          log.debug('slot:clear-noop', { slot, sourceTrait, reason: !slotSources ? 'no-slot' : 'no-source' });
          return prev;
        }
        const content = slotSources[sourceKey];
        const timer = timersRef.current.get(content.id);
        if (timer) {
          clearTimeout(timer);
          timersRef.current.delete(content.id);
        }
        content.onDismiss?.();
        if (content.sourceTrait && !isNotificationSlot(slot)) {
          unindexTrait(content.sourceTrait);
          notifyTraitSubscribers(content.sourceTrait, null);
        }
        const nextSources: SlotSources = { ...slotSources };
        delete nextSources[sourceKey];
        log.info('slot:cleared', { slot, sourceTrait, lastPatternType: content.pattern });
        notifySubscribers(slot, aggregateSlot(nextSources));
        return { ...prev, [slot]: nextSources };
      });
    },
    [notifySubscribers, notifyTraitSubscribers, unindexTrait],
  );

  // Clear content by ID — finds and removes the matching entry.
  const clearById = useCallback(
    (id: string) => {
      setSources((prev) => {
        for (const slot of ALL_SLOTS) {
          const slotSources = prev[slot];
          if (!slotSources) continue;
          const matchKey = Object.keys(slotSources).find(
            (k) => slotSources[k].id === id,
          );
          if (!matchKey) continue;
          const content = slotSources[matchKey];
          const timer = timersRef.current.get(id);
          if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(id);
          }
          content.onDismiss?.();
          if (content.sourceTrait && !isNotificationSlot(slot)) {
            unindexTrait(content.sourceTrait);
            notifyTraitSubscribers(content.sourceTrait, null);
          }
          const nextSources: SlotSources = { ...slotSources };
          delete nextSources[matchKey];
          notifySubscribers(slot, aggregateSlot(nextSources));
          return { ...prev, [slot]: nextSources };
        }
        return prev;
      });
    },
    [notifySubscribers, notifyTraitSubscribers, unindexTrait],
  );

  // Clear all slots
  const clearAll = useCallback(() => {
    // Clear all timers
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();

    setSources((prev) => {
      // Call onDismiss for every source entry and notify subscribers.
      for (const slot of ALL_SLOTS) {
        const slotSources = prev[slot];
        if (!slotSources) continue;
        for (const content of Object.values(slotSources)) {
          content.onDismiss?.();
          if (content.sourceTrait) {
            notifyTraitSubscribers(content.sourceTrait, null);
          }
        }
        notifySubscribers(slot, null);
      }
      return DEFAULT_SOURCES;
    });
    // Wipe the whole trait index after clearing.
    traitIndexRef.current.clear();
  }, [notifySubscribers, notifyTraitSubscribers]);

  // Subscribe to slot changes
  const subscribe = useCallback((callback: SlotChangeCallback): (() => void) => {
    subscribersRef.current.add(callback);
    return () => {
      subscribersRef.current.delete(callback);
    };
  }, []);

  // Check if slot has content
  const hasContent = useCallback(
    (slot: UISlot): boolean => slots[slot] !== null,
    [slots],
  );

  // Get aggregated content for a slot.
  const getContent = useCallback(
    (slot: UISlot): SlotContent | null => slots[slot] ?? null,
    [slots],
  );

  // Look up the last-rendered content for a given trait. Single-entry
  // per trait — no per-slot disambiguation.
  const getTraitContent = useCallback(
    (traitName: string): SlotContent | null =>
      traitIndexRef.current.get(traitName) ?? null,
    [],
  );

  // Subscribe to a specific trait's render changes. Returns an unsubscribe.
  const subscribeTrait = useCallback(
    (traitName: string, callback: TraitChangeCallback): (() => void) => {
      let set = traitSubscribersRef.current.get(traitName);
      if (!set) {
        set = new Set();
        traitSubscribersRef.current.set(traitName, set);
      }
      set.add(callback);
      return () => {
        const s = traitSubscribersRef.current.get(traitName);
        if (!s) return;
        s.delete(callback);
        if (s.size === 0) {
          traitSubscribersRef.current.delete(traitName);
        }
      };
    },
    [],
  );

  // Sidecar-only update: write to the per-trait index and notify trait
  // subscribers, but do NOT touch any slot's source map. Used for
  // embed-aware slot routing — see the JSDoc on UISlotManager.
  const updateTraitContent = useCallback(
    (traitName: string, content: Omit<SlotContent, 'id' | 'sourceTrait'>): string => {
      // Deterministic per-trait id (same rationale as `render()` above): re-emitting an
      // embedded `@trait.X` sidecar reuses the SAME id so React reconciles the embedded
      // subtree instead of remounting it.
      const id = `slot-content-trait-${traitName}`;
      const fullContent: SlotContent = { ...content, id, sourceTrait: traitName };
      indexTraitRender(traitName, fullContent);
      notifyTraitSubscribers(traitName, fullContent);
      return id;
    },
    [indexTraitRender, notifyTraitSubscribers],
  );

  return {
    slots,
    render,
    clear,
    clearBySource,
    clearById,
    clearAll,
    subscribe,
    hasContent,
    getContent,
    getTraitContent,
    subscribeTrait,
    updateTraitContent,
  };
}

// ============================================================================
// Exports
// ============================================================================

export { DEFAULT_SLOTS };
