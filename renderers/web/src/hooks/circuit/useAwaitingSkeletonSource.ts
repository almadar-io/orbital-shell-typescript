/**
 * The `AwaitingSkeletonSource` over a circuit store: each awaiting trait's
 * entry (`store.awaiting`, kept by the client kernel from server-leg send
 * until fold or error) selects the transition it took, and that transition's
 * compiler-predicted `awaitRender` entries say which slot / trait frame will
 * render what. Embedded traits render inside frames, never into a top-level
 * slot, so slot lookups skip them.
 *
 * @packageDocumentation
 */
import { useMemo } from 'react';
import { AwaitRenderSchema, type AwaitRender } from '@almadar/core';
import type { CircuitSurface } from '../../lib/circuit-surface';
import type { CircuitStore } from '../../index';
import type { AwaitingSkeletonSource } from '../../providers/AwaitingSkeletonContext';

export function useAwaitingSkeletonSource(
  store: CircuitStore,
  traitIndex: CircuitSurface,
  embeddedTraits: ReadonlySet<string> | undefined,
): AwaitingSkeletonSource {
  return useMemo<AwaitingSkeletonSource>(() => {
    const activeRenders = (): AwaitRender[] => {
      const renders: AwaitRender[] = [];
      for (const awaiting of store.awaiting.list()) {
        const transitions = traitIndex.byName.get(awaiting.trait)?.transitions ?? [];
        const taken = transitions.find((t) => t.event === awaiting.event && t.from === awaiting.from);
        if (taken?.awaitRender !== undefined) renders.push(...AwaitRenderSchema.array().parse(taken.awaitRender));
      }
      return renders;
    };
    return {
      forSlot: (slot) =>
        activeRenders().find((r) => r.slot === slot && !(embeddedTraits?.has(r.trait) ?? false))?.skeleton,
      forTrait: (traitName) => activeRenders().find((r) => r.trait === traitName)?.skeleton,
      subscribe: (callback) => store.awaiting.subscribeAll(callback),
      getVersion: () => store.awaiting.getVersion(),
    };
  }, [store, traitIndex, embeddedTraits]);
}
