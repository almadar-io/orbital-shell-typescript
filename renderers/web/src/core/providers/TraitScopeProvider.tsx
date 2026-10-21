'use client';
/**
 * TraitScopeProvider
 *
 * Wraps a trait's rendered subtree with its owning `{ orbital, trait }`
 * pair. Pure components inside the subtree (Button, Form, etc.) keep
 * calling `useEventBus().emit('UI:X', ...)` exactly as today; the
 * scoped wrapper that `useEventBus` returns inside this provider
 * rewrites bare `UI:X` keys into the qualified
 * `UI:Orbital.Trait.X` form that `useTraitStateMachine` (and the rest
 * of the post-Phase 4 subscriber side) listens on.
 *
 * Producer-side fix for the gap where Button-emitted bare keys never
 * reached the trait state machine in the runtime path. The compiled
 * path's codegen wraps each trait view with the same provider so both
 * paths share the qualification contract.
 *
 * ## Embedded-trait emit bubbling (R-EMBEDDED-EMIT-BUBBLE)
 *
 * Providers NEST: when a trait's `render-ui` embeds another trait
 * (`@trait.X` / inline `<External.Trait …/>`), the embedded view is
 * rendered inside the host's subtree AND wraps itself in its own
 * provider. The context therefore carries the full scope CHAIN
 * (innermost-first), not a single scope. `useEventBus` fans every
 * `UI:*` emit out to each scope on the chain so the host trait's
 * subscribers hear emits from the embedded trait — a button authored
 * as `<UiButton.traits.ButtonRender action={CREATE}/>` inside a host
 * dispatches on the host's qualified key, not only the hoisted atom's.
 *
 * @packageDocumentation
 */

import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Box } from '../atoms/Box';
import { getTraitPresence } from '../lib/traitPresence';

export interface TraitScope {
  /** Owning orbital name (e.g. `"ContactOrbital"`). */
  orbital: string;
  /** Trait name within the orbital (e.g. `"ContactBrowse"`). */
  trait: string;
}

/**
 * Scope chain, innermost-first. `chain[0]` is the trait whose subtree
 * the caller renders inside; `chain[1..]` are its host ancestors (the
 * traits whose `render-ui` embedded it, outermost last). An empty
 * chain means the caller is outside any `TraitScopeProvider`.
 */
type TraitScopeChain = readonly TraitScope[];

/** Stable empty chain — returned by `useTraitScopeChain` outside any
 *  provider so `useEventBus`'s `useMemo([..., chain])` doesn't bust every
 *  render (a fresh `[]` each call caused an infinite-rerender regression). */
const EMPTY_CHAIN: TraitScopeChain = Object.freeze([]) as TraitScopeChain;

const TraitScopeContext = createContext<TraitScopeChain | null>(null);

export interface TraitScopeProviderProps {
  orbital: string;
  trait: string;
  // Optional: React.createElement passes children POSITIONALLY (third arg),
  // and a required children prop makes those call sites fail tsc (TS2769)
  // even though children are provided.
  children?: React.ReactNode;
}

/**
 * Wrap a trait's rendered subtree to qualify bare `UI:*` emits with the
 * trait's scope. Mount this at the slot-content boundary in runtime
 * mode (UISlotRenderer) and at each generated trait view's outermost
 * element in compiled mode (orbital-shell-typescript codegen). Nesting
 * is preserved: a provider prepends itself to the parent chain so
 * embedded-trait emits can bubble to their host.
 */
export function TraitScopeProvider({
  orbital,
  trait,
  children,
}: TraitScopeProviderProps): React.ReactElement {
  const parentChain = useContext(TraitScopeContext);
  const value = useMemo<TraitScopeChain>(() => {
    const self: TraitScope = { orbital, trait };
    // parentChain is innermost-first; prepend self to keep that order.
    return parentChain && parentChain.length > 0
      ? [self, ...parentChain]
      : [self];
  }, [orbital, trait, parentChain]);
  const watched = useSyncExternalStore(
    presence.subscribe,
    () => presence.isWatched(trait),
    () => false,
  );
  return (
    <TraitScopeContext.Provider value={value}>
      {watched ? <TraitPresenceRoot trait={trait}>{children}</TraitPresenceRoot> : children}
    </TraitScopeContext.Provider>
  );
}

const presence = getTraitPresence();

/** A `[visible]` tick's trait: its output sits in a `display: contents` box the presence registry tracks. */
function TraitPresenceRoot({ trait, children }: { trait: string; children?: React.ReactNode }): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    return el === null ? undefined : presence.attach(trait, el);
  }, [trait]);
  return <Box ref={ref} className="contents" data-trait-presence={trait}>{children}</Box>;
}

/**
 * Read the full trait-scope chain, innermost-first. Empty when called
 * outside any `TraitScopeProvider` (e.g. Storybook, design-system
 * catalog). `useEventBus` uses this to fan embedded-trait emits out to
 * every host ancestor.
 */
export function useTraitScopeChain(): TraitScopeChain {
  const chain = useContext(TraitScopeContext);
  return chain ?? EMPTY_CHAIN;
}

/**
 * Read the innermost (nearest) trait scope. Returns `null` when called
 * outside any `TraitScopeProvider`. Kept for callers that only need the
 * immediate scope.
 */
export function useTraitScope(): TraitScope | null {
  const chain = useContext(TraitScopeContext);
  return chain && chain.length > 0 ? chain[0] : null;
}

export default TraitScopeProvider;
