'use client';
/**
 * AwaitingSkeletonContext — the awaiting-server skeleton an empty slot or
 * embedded frame shows while a trait's server round trip is in flight.
 *
 * The source joins the kernel's awaiting registry (`AwaitingTrait`, which
 * trait is waiting on which transition) with that transition's
 * compiler-predicted `awaitRender` entries. With no provider (compiled shell,
 * static renders) nothing is ever awaiting — the compiled View passes
 * `awaitingSkeleton` to `UISlotComponent` directly.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { SkeletonNode } from '@almadar/core';

export interface AwaitingSkeletonSource {
  /** The predicted skeleton for a top-level slot, from a non-embedded awaiting render. */
  forSlot: (slot: string) => SkeletonNode | undefined;
  /** The predicted skeleton for an embedded trait's frame. */
  forTrait: (traitName: string) => SkeletonNode | undefined;
  subscribe: (callback: () => void) => () => void;
  getVersion: () => number;
}

export const AwaitingSkeletonContext = createContext<AwaitingSkeletonSource | null>(null);

const NOOP_SUBSCRIBE = (): (() => void) => () => undefined;
const ZERO = (): number => 0;

export function useAwaitingSkeleton(target: { slot: string } | { trait: string }): SkeletonNode | undefined {
  const source = useContext(AwaitingSkeletonContext);
  useSyncExternalStore(source?.subscribe ?? NOOP_SUBSCRIBE, source?.getVersion ?? ZERO, ZERO);
  if (source === null) return undefined;
  return 'slot' in target ? source.forSlot(target.slot) : source.forTrait(target.trait);
}
