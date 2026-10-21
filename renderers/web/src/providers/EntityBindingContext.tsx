'use client';
/**
 * EntityBindingContext
 *
 * Live per-trait binding snapshots the renderer resolves
 * `RenderBindingMarker`s (`$renderBinding` prop leaves, `@almadar/core`)
 * against. The interpreted path's executor carries `@entity`-dependent
 * render-ui leaves into slot content as markers instead of resolving them
 * at flush time; `useEntityBindingSnapshot` bridges the owning trait's
 * live entity store into React via `useSyncExternalStore`, so marked
 * props re-evaluate on every committed write — the same model the
 * compiled shell uses (state-based JSX reading `fields?.X` per render).
 *
 * Owned by `useTraitStateMachine` (the one component that holds
 * `traitFieldStatesRef` / `sharedEntityStore`); provided to the slot
 * subtree by OrbPreview's TraitInitializer.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { EntityRow, TraitConfig } from '@almadar/core';

/**
 * Read + subscribe surface over the live trait binding stores. Snapshots
 * are cached objects — a new reference only when the trait's entity
 * actually changed (the `useSyncExternalStore` contract).
 */
export interface EntityBindingSource {
  /** Current entity snapshot for a trait (shared-entity traits read the shared store). */
  getEntitySnapshot: (traitName: string) => EntityRow;
  /** Merged render-time config (declared defaults < resolved < call-site). */
  getConfig: (traitName: string) => TraitConfig | undefined;
  /** Current state-machine state — evaluation context for `@state` in marked expressions. */
  getState: (traitName: string) => string;
  /** Subscribe to entity commits for a trait. Returns unsubscribe. */
  subscribe: (traitName: string, callback: () => void) => () => void;
}

export const EntityBindingContext = createContext<EntityBindingSource | null>(null);

const EMPTY_ENTITY: EntityRow = {};
const NOOP_SUBSCRIBE = (): (() => void) => () => undefined;

/**
 * Bridge one trait's live bindings into React. With no provider (compiled
 * shell, static renders) or no owning trait, returns empty bindings and
 * never re-renders — markers resolve to the same `undefined` they would
 * have resolved to at flush time against an empty entity.
 */
export function useEntityBindingSnapshot(traitName: string | undefined): {
  entity: EntityRow;
  config: TraitConfig | undefined;
  state: string;
} {
  const source = useContext(EntityBindingContext);
  const entity = useSyncExternalStore(
    source !== null && traitName !== undefined
      ? (onStoreChange) => source.subscribe(traitName, onStoreChange)
      : NOOP_SUBSCRIBE,
    () => (source !== null && traitName !== undefined ? source.getEntitySnapshot(traitName) : EMPTY_ENTITY),
  );
  // The source rebuilds only when its inputs change (bindings map, shared
  // store), so memoing on it keeps the config object identity-stable
  // across renders — downstream `useMemo` on resolved props depends on it.
  const config = useMemo(
    () => (source !== null && traitName !== undefined ? source.getConfig(traitName) : undefined),
    [source, traitName],
  );
  return {
    entity,
    config,
    state: source !== null && traitName !== undefined ? source.getState(traitName) : '',
  };
}
