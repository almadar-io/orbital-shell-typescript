// @vitest-environment jsdom
/**
 * R-SLOT-MULTI-SOURCE-STACK-DROPS-TRAIT-SCOPE — per-source attribution must
 * survive slot aggregation.
 *
 * When two or more traits render into the same slot, `aggregateSlot` collapses
 * them into one synthetic `stack` whose own `sourceTrait` is a sentinel
 * (`__multi_source_stack__`) — no single trait owns the wrapper. Before this
 * guard, the per-source names were discarded at that point, so
 * `UISlotRenderer`'s `MaybeTraitScope` failed its `orbitalsByTrait` lookup on
 * the sentinel and rendered the whole stack WITHOUT a `TraitScopeProvider`.
 * With no scope in the tree, a bare `UI:X` emit from an affordance inside the
 * stack could not be qualified to its owning trait's key, so cross-trait
 * listeners never heard it and the click was silently dead — live-reproduced
 * on std-restaurant-pos `/kitchen`, where the row's Open button emitted only
 * `UI:PosKitchenOrbital.InlineDataGridRender6.OPEN_TICKET` (listeners:
 * verification telemetry only) and sent nothing to the server.
 *
 * The compiled path has no equivalent hazard — codegen emits
 * `<TraitScopeProvider>` lexically around each trait's own markup — so these
 * cases also pin runtime/compiled parity.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUISlotManager } from '../../src/hooks/useUISlots';

type StackChild = { type: string; _sourceTrait?: string };

function childrenOf(props: Record<string, unknown> | undefined): StackChild[] {
  const children = props?.['children'];
  return Array.isArray(children) ? (children as StackChild[]) : [];
}

describe('multi-source slot aggregation — trait attribution', () => {
  it('tags each stacked child with its own source trait', () => {
    const { result } = renderHook(() => useUISlotManager());

    act(() => {
      result.current.render({ target: 'main', pattern: 'data-grid', sourceTrait: 'KitchenBoard' });
      result.current.render({ target: 'main', pattern: 'stat-display', sourceTrait: 'KitchenTicketStats' });
    });

    const content = result.current.slots['main'];
    expect(content).not.toBeNull();
    // The wrapper itself stays owner-less …
    expect(content?.pattern).toBe('stack');
    expect(content?.sourceTrait).toBe('__multi_source_stack__');
    // … but every child names the trait that produced it, which is what
    // lets the renderer establish that trait's scope for its own subtree.
    const mainProps = content?.props;
    if (typeof mainProps === 'string' || mainProps === undefined) throw new Error(`expected object props, got ${typeof mainProps}`);
    const children = childrenOf(mainProps);
    expect(children).toHaveLength(2);
    expect(children.map((c) => c._sourceTrait)).toEqual(['KitchenBoard', 'KitchenTicketStats']);
    expect(children.map((c) => c.type)).toEqual(['data-grid', 'stat-display']);
  });

  it('leaves a single-source slot untouched (no synthetic wrapper, real sourceTrait)', () => {
    const { result } = renderHook(() => useUISlotManager());

    act(() => {
      result.current.render({ target: 'main', pattern: 'data-grid', sourceTrait: 'RunbookManage' });
    });

    const content = result.current.slots['main'];
    expect(content?.pattern).toBe('data-grid');
    expect(content?.sourceTrait).toBe('RunbookManage');
  });

  it('omits the sidecar for a source-less render rather than inventing a trait name', () => {
    const { result } = renderHook(() => useUISlotManager());

    act(() => {
      result.current.render({ target: 'main', pattern: 'data-grid' });
      result.current.render({ target: 'main', pattern: 'stat-display', sourceTrait: 'RealTrait' });
    });

    const stackProps = result.current.slots['main']?.props;
    if (typeof stackProps === 'string' || stackProps === undefined) throw new Error(`expected object props, got ${typeof stackProps}`);
    const children = childrenOf(stackProps);
    expect(children).toHaveLength(2);
    // The anonymous source carries no `_sourceTrait` — a name it does not
    // have must not be fabricated, or the renderer would scope to a
    // non-existent trait.
    expect(children[0]._sourceTrait).toBeUndefined();
    expect(children[1]._sourceTrait).toBe('RealTrait');
  });
});
