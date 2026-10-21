'use client';
/**
 * useSharedEntityStore
 *
 * In-memory store for a `[shared]` entity: several traits bound to it each
 * contribute field writes per tick, and one render trait paints the merged
 * result. Store shape mirrors useUISlotManager (useUISlots.ts) — a subscriber
 * Set per key with a try/catch notify loop — but keyed by entity id, never by
 * trait, so disjoint writers sharing an entity never fight over a key.
 * `runTickFrame` folds each writer's writes into a running scratch via
 * `mergeEntityFrame` (so writer k+1 reads writer k's same-frame writes) and
 * commits ONCE per frame — the only point that notifies subscribers, so N
 * writes never trigger N renders.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import type { EntityFieldWrite, EntityFrameState } from '@almadar/core';
import { mergeEntityFrame } from '@almadar/core';
import { createLogger } from '@almadar/logger';

const log = createLogger('almadar:ui:shared-entity-store');

const EMPTY_ENTITY_STATE: EntityFrameState = {};

/** Notification callback fired after a `commit()` for the subscribed entity id. */
export type SharedEntitySubscriber = () => void;

/**
 * One writer trait's per-frame step: reads the live running scratch
 * (reflecting every earlier writer's writes this frame) and returns its own
 * field writes. Pure — writers never call `store.commit`; only `runTickFrame`
 * does, once per frame.
 */
export type SharedEntityWriter = (scratch: EntityFrameState) => readonly EntityFieldWrite[];

/** Manager surface, keyed by entity id. */
export interface SharedEntityStore {
  getSnapshot: (entityId: string) => EntityFrameState;
  subscribe: (entityId: string, callback: SharedEntitySubscriber) => () => void;
  commit: (entityId: string, nextState: EntityFrameState) => void;
  /**
   * Set the initial state for an entity id, but ONLY if nothing is committed
   * yet — idempotent, and (unlike `commit`) does NOT notify subscribers, so it
   * is safe to call during render. Both execution paths seed from the entity's
   * declared field defaults at init, so frame 0 reads the defaults on both.
   */
  seed: (entityId: string, initialState: EntityFrameState) => void;
}

/**
 * Create a standalone shared-entity store. Plain factory — no React — so a
 * clock owner (the interpreter's TickScheduler, or a codegen rAF
 * `useEffect`) can hold one instance and pass it to `runTickFrame` without
 * going through a hook.
 */
export function createSharedEntityStore(): SharedEntityStore {
  const states = new Map<string, EntityFrameState>();
  const subscribers = new Map<string, Set<SharedEntitySubscriber>>();

  const getSnapshot = (entityId: string): EntityFrameState =>
    states.get(entityId) ?? EMPTY_ENTITY_STATE;

  const subscribe = (entityId: string, callback: SharedEntitySubscriber): (() => void) => {
    let set = subscribers.get(entityId);
    if (!set) {
      set = new Set();
      subscribers.set(entityId, set);
    }
    set.add(callback);
    return () => {
      const current = subscribers.get(entityId);
      if (!current) return;
      current.delete(callback);
      if (current.size === 0) {
        subscribers.delete(entityId);
      }
    };
  };

  const commit = (entityId: string, nextState: EntityFrameState): void => {
    states.set(entityId, nextState);
    const set = subscribers.get(entityId);
    if (!set) return;
    set.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        log.error('Shared entity subscriber error', {
          entityId,
          error: error instanceof Error ? error : String(error),
        });
      }
    });
  };

  const seed = (entityId: string, initialState: EntityFrameState): void => {
    if (!states.has(entityId)) {
      states.set(entityId, initialState);
    }
  };

  return { getSnapshot, subscribe, commit, seed };
}

/**
 * React hook: one stable `SharedEntityStore` instance for this component's
 * lifetime (useUISlotManager's ref-backed-instance pattern — no re-creation
 * across re-renders). Callers own one store per running orbital instance and
 * thread it to each writer trait plus the render trait via `runTickFrame` /
 * `useSharedEntitySnapshot`.
 */
export function useSharedEntityStore(): SharedEntityStore {
  const storeRef = useRef<SharedEntityStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createSharedEntityStore();
  }
  return storeRef.current;
}

/**
 * Cross-component access to ONE `SharedEntityStore` instance. `useSharedEntityStore`
 * is `useRef`-scoped to its own call site — correct for a single owner (the JS
 * runtime path's `useTraitStateMachine` interprets a whole orbital in one hook
 * call), but the compiled path (`orbital-rust`'s TS-shell codegen) generates one
 * hook + component PER TRAIT, so several independent trait hooks bound to the
 * SAME `[shared]` entity need the SAME store instance. A page-level owner calls
 * `useSharedEntityStore()` once and provides it here; every trait hook on that
 * page reads it back via `useSharedEntityStoreContext()` instead of creating its
 * own disconnected store. Not used by the JS runtime path today — purely
 * additive, zero effect on `useSharedEntityStore`'s existing single-caller
 * behavior.
 */
export const SharedEntityStoreContext = createContext<SharedEntityStore | null>(null);

/** Read the page-level `SharedEntityStore` provided by `SharedEntityStoreContext`. */
export function useSharedEntityStoreContext(): SharedEntityStore {
  const store = useContext(SharedEntityStoreContext);
  if (!store) {
    throw new Error(
      'useSharedEntityStoreContext: no SharedEntityStoreContext.Provider found in the component tree',
    );
  }
  return store;
}

/**
 * Bridge one entity's snapshot into React via `useSyncExternalStore` (the
 * codebase's established store->React bridge, see `lib/perf.ts`). The render
 * trait re-renders exactly when `runTickFrame` commits this entity — never on
 * an intermediate per-writer write, since those never call `store.commit`.
 */
export function useSharedEntitySnapshot(store: SharedEntityStore, entityId: string): EntityFrameState {
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(entityId, onStoreChange),
    () => store.getSnapshot(entityId),
  );
}

/**
 * Run one frame for `entityId`: fold each writer's writes into a running
 * scratch in binding order via `mergeEntityFrame` (field-level, so writer
 * k+1 reads writer k's same-frame writes), then commit the merged result
 * exactly ONCE. Clock-agnostic — the caller (a TickScheduler tick or a
 * codegen rAF loop) invokes this once per frame; it owns no timer itself.
 */
export function runTickFrame(
  entityId: string,
  orderedWriters: readonly SharedEntityWriter[],
  store: SharedEntityStore,
): EntityFrameState {
  let scratch = store.getSnapshot(entityId);
  for (const writer of orderedWriters) {
    const writes = writer(scratch);
    scratch = mergeEntityFrame(scratch, writes);
  }
  store.commit(entityId, scratch);
  return scratch;
}
