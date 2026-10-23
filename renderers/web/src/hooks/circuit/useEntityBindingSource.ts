/**
 * useEntityBindingSource — W5b (docs/Almadar_Runtime_Stateless_Stateful_PLAN.md §5.1).
 *
 * The `EntityBindingSource` surface (`RenderBindingMarker` resolution) over
 * `CircuitStore` frames, subscribed via `useSyncExternalStore(store.subscribe,
 * store.getVersion)`. Replaces the old hook's dual-track
 * `bindingSnapshotsRef`/`sharedEntityStore` split entirely: `frames` is
 * already keyed by `IndexedTrait.frameKey` (`$shared::<entity>` for a
 * `[shared]` entity, the trait's own name otherwise — `trait-index.ts`), so
 * a shared entity's traits already read/write the SAME frame with no
 * separate store. `@config` is the kernel's own resolved config (`traitConfig`).
 *
 * @packageDocumentation
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { EntityRow } from '@almadar/core';
import type { TraitIndex } from '@almadar/core';
import type { CircuitStore } from '../../index';
import type { EntityBindingSource } from '../../providers/EntityBindingContext';
import type { KernelClient } from '../../lib/kernel-client';

const EMPTY_ENTITY: EntityRow = {};

export function useEntityBindingSource(
  store: CircuitStore,
  traitIndex: TraitIndex,
  /** The kernel engine's client: its trait states are the source of `@state`; rows arrive through the store it mirrors into. */
  kernel?: Pick<KernelClient, 'traitState' | 'traitConfig'>,
): EntityBindingSource {
  // Re-render every binding-source consumer on any circuit commit — the
  // store's own `notify()` is global (one version counter for the whole
  // circuit), so this hook subscribes once here rather than per trait; each
  // consumer's own `useSyncExternalStore(source.subscribe(traitName, ...))`
  // call still only repaints when ITS OWN `getEntitySnapshot`/`getState`
  // result actually changed reference.
  useSyncExternalStore(store.subscribe, store.getVersion);

  return useMemo<EntityBindingSource>(() => {
    // Effect runners write the live frame in place, so the frame's own
    // identity never changes; the snapshot is a shallow copy re-minted only
    // when some field differs — a new value exactly when the entity changed.
    const snapshots = new Map<string, EntityRow>();
    return {
      getEntitySnapshot: (traitName) => {
        const entry = traitIndex.byName.get(traitName);
        const frameKey = entry?.frameKey ?? traitName;
        const frame = store.frames.get(frameKey);
        if (frame === undefined) return EMPTY_ENTITY;
        const previous = snapshots.get(frameKey);
        if (previous !== undefined && sameFields(previous, frame)) return previous;
        const next = { ...frame };
        snapshots.set(frameKey, next);
        return next;
      },
      // A render scope that names no trait of the program (a mount scope) has no config.
      getConfig: (traitName) => (traitIndex.byName.has(traitName) ? kernel?.traitConfig(traitName) : undefined),
      getState: (traitName) => (kernel !== undefined
        ? kernel.traitState(traitName)
        : store.states.getState(traitName)?.currentState) ?? '',
      subscribe: (_traitName, callback) => store.subscribe(callback),
    };
  }, [store, traitIndex, kernel]);
}

function sameFields(a: EntityRow, b: EntityRow): boolean {
  const keys = Object.keys(b);
  if (Object.keys(a).length !== keys.length) return false;
  for (const key of keys) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}
