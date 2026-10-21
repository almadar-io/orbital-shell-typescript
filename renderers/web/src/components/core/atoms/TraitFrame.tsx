/**
 * TraitFrame — renders the current frame of a referenced trait.
 *
 * Resolves the `@trait.X[.slot]` binding at render time by looking up the
 * referenced trait's last `render-ui` payload from the orbital's
 * `UISlotManager`. Re-renders automatically when that trait transitions
 * via the per-trait subscription channel (`subscribeTrait`).
 *
 * This is the single rendering primitive both runtime paths converge on:
 *
 * - **Interpreted path** — the trait-binding resolver in
 *   `renderer/trait-binding-resolver.ts` walks pattern trees at render
 *   time, substituting `"@trait.X"` string children with this component.
 * - **Compiled path** — the TypeScript shell codegen in
 *   `orbital-shell-typescript/src/backend.rs::pattern_to_jsx_with_data`
 *   emits this component directly into generated JSX wherever a
 *   `@trait.*` string appears in a pattern tree.
 *
 * Embedding is passive: the referenced trait's state machine runs
 * unchanged; TraitFrame is only a read-only lens on its current frame.
 * Event propagation happens over the shared event bus, not through this
 * component.
 *
 * @see docs/Almadar_Std_Gaps.md §3.8 for the full language design.
 */

import React, { Suspense, lazy, useEffect, useState } from "react";
import { useUISlots } from "../../../providers/UISlotContext";
import type { SlotContent } from "../../../hooks/useUISlots";
import { TraitScopeProvider } from '../../../core';
import { useEntitySchemaOptional } from "../../../providers/EntitySchemaContext";
import { useAwaitingSkeleton } from "../../../providers/AwaitingSkeletonContext";
import { SkeletonTree } from "../molecules/Skeleton";

// `UISlotRenderer.tsx` imports from this file via
// `trait-binding-resolver`, which embeds `<TraitFrame>` — a static import
// would close the cycle at module-init time. A lazy dynamic import defers
// the module's execution until first render, which breaks the cycle by
// construction, and stays loader-portable (the previous CJS `require`
// resolved only inside the compiled bundle — under any source-native ESM
// loader such as vitest, `require('../organisms/UISlotRenderer')` cannot
// resolve the `.tsx` source and the embedded frame crashed to the error
// boundary).
const LazySlotContentRenderer = lazy(() =>
  import("../organisms/UISlotRenderer").then((m) => ({
    default: m.SlotContentRenderer,
  })),
);

export interface TraitFrameProps {
  /**
   * Name of the trait whose current frame to embed. Must match a trait
   * declared in the current orbital. Compiler validates that the name
   * exists at build time (see `ORB_BINDING_TRAIT_UNKNOWN`).
   */
  traitName: string;
  /**
   * Rendered when the referenced trait has not (yet) emitted any
   * render-ui. Use a skeleton, spinner, or message. Defaults to `null`
   * (renders nothing), so an unfulfilled reference drops cleanly out of
   * a parent `children:` array.
   */
  fallback?: React.ReactNode;
}

/**
 * Subscribe to a trait's render-output changes and return the current
 * content. Internal hook — callers usually want the `<TraitFrame>`
 * component below, which also renders.
 */
function useTraitContent(traitName: string): SlotContent | null {
  const slotManager = useUISlots();
  // Initial read happens synchronously so first render has the latest
  // content without an extra effect cycle.
  const [content, setContent] = useState<SlotContent | null>(() =>
    slotManager.getTraitContent(traitName),
  );

  useEffect(() => {
    // Re-read on mount in case the trait rendered between initial state
    // computation and effect fire. Also covers remounting after a
    // traitName prop change.
    setContent(slotManager.getTraitContent(traitName));

    const unsubscribe = slotManager.subscribeTrait(traitName, (nextContent) => {
      setContent(nextContent ?? slotManager.getTraitContent(traitName));
    });
    return unsubscribe;
  }, [slotManager, traitName]);

  return content;
}

/**
 * Render the embedded trait's current frame via the registered pattern
 * component for its `SlotContent.pattern` + `props`. Falls back when the
 * referenced trait has no content in the target slot.
 *
 * The import path for pattern rendering matches what `SlotContentRenderer`
 * uses, so both the top-level slot render path and this embedded path go
 * through the same resolver (`getComponentForPattern` + prop handling).
 */
export function TraitFrame({
  traitName,
  fallback = null,
}: TraitFrameProps): React.ReactElement | null {
  const content = useTraitContent(traitName);
  const awaiting = useAwaitingSkeleton({ trait: traitName });
  // Look up the embedded trait's owning orbital so we can wrap its
  // rendered subtree in a `<TraitScopeProvider>` scoped to that
  // (orbital, trait) pair. Without this wrap, bare `UI:CLEAR`-style
  // emits from buttons inside the embedded content qualify against
  // whatever scope is at the embedding site (the parent layout's
  // scope), so an atom's button click ends up dispatched as
  // `UI:Orbital.Layout.CLEAR` instead of `UI:Orbital.Atom.CLEAR` —
  // which the atom's state machine never sees, breaking the
  // composition contract.
  const entitySchema = useEntitySchemaOptional();
  const orbital = entitySchema?.orbitalsByTrait.get(traitName);

  if (!content) {
    return awaiting !== undefined ? <SkeletonTree node={awaiting} /> : <>{fallback}</>;
  }

  // We lean on the existing slot-renderer machinery so children of
  // embedded patterns (including nested `@trait.*` references) go
  // through the same recursive walker. The renderer is lazy-loaded
  // (module-level `lazy()` above) to avoid the TraitFrame ↔
  // UISlotRenderer module-graph cycle.
  const rendered = (
    <Suspense fallback={fallback}>
      <LazySlotContentRenderer
        content={content}
        onDismiss={() => {
          // Embedded frames are read-only lenses. Dismissals surface via
          // the host trait's own state-machine transitions (its emits on
          // the shared event bus), not through this component.
        }}
      />
    </Suspense>
  );

  if (!orbital) {
    return rendered;
  }

  return (
    <TraitScopeProvider orbital={orbital} trait={traitName}>
      {rendered}
    </TraitScopeProvider>
  );
}
TraitFrame.displayName = "TraitFrame";
