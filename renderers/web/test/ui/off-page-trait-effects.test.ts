/**
 * Retargeted from `applyServerEffects`/`collectServerActiveTraits` (deleted
 * with `OrbPreview.tsx`'s old dual round-trip — W5b,
 * `docs/Almadar_Runtime_Stateless_Stateful_PLAN.md` §5.1).
 *
 * The off-page render filter (Gap #11: "an orbital bundling several page
 * composers returns render-ui effects for traits not mounted on the active
 * page") is now `useSlotFlush.applyClientEffects`'s job — see that hook's
 * `activeTraits` parameter.
 *
 * `collectServerActiveTraits`'s job — scoping which traits the SERVER
 * EXECUTES via a `payload._activeTraits` sidecar on an untargeted/broadcast
 * dispatch — has no surviving call site: every dispatch the client role
 * makes (`dispatchWithServerLeg`) is `targetTrait`-scoped to exactly one
 * seed trait (plan §4.2 P4), including the mount-time lifecycle dispatch
 * (`useTraitStateMachine` fires each trait's own INIT/LOAD/$MOUNT
 * individually now, not as one broadcast). A page leaking another page's
 * composer requires an untargeted dispatch to exist in the first place,
 * which the new architecture never produces — the invariant is now
 * structural rather than a runtime filter, so there is nothing left here to
 * unit-test as a standalone function.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSlotFlush, type SlotFlushHandle } from '../../src/hooks/circuit/useSlotFlush';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import type { SlotPatternEntry } from '../../src/types/slot-types';
import type { ClientEffectTuple } from '@almadar/core';

function stubSlots(): UISlotManager & { render: ReturnType<typeof vi.fn>; updateTraitContent: ReturnType<typeof vi.fn> } {
  return {
    slots: {},
    render: vi.fn(() => 'id'),
    clear: vi.fn(),
    clearBySource: vi.fn(),
    clearById: vi.fn(),
    clearAll: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    hasContent: vi.fn(() => false),
    getContent: vi.fn(() => null),
    getTraitContent: vi.fn(() => null),
    subscribeTrait: vi.fn(() => () => undefined),
    updateTraitContent: vi.fn(() => 'id'),
  };
}

const renderEffect = (traitName: string): { traitName: string; effect: ClientEffectTuple } => ({
  traitName,
  effect: ['render-ui', 'main', { type: 'box' }],
});

describe('useSlotFlush — handle identity', () => {
  // The returned handle must be identity-stable across re-renders:
  // useTraitStateMachine's dispatchAndSettle deps on it, and the
  // mount-lifecycle INIT effect deps on dispatchAndSettle — a fresh handle
  // per render refired INIT forever (live-verified INIT/fetch storm,
  // 2026-09-23).
  it('returns the same handle object across re-renders', () => {
    const slots = stubSlots();
    const { result, rerender } = renderHook(() => useSlotFlush(slots, undefined));
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('useSlotFlush.applyClientEffects — off-page trait filter', () => {
  it('drops render-ui effects from traits not mounted on the active page', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, undefined));
    result.current.applyClientEffects(
      [renderEffect('OnPageComposer'), renderEffect('OffPageComposer')],
      undefined,
      undefined,
      new Set(['OnPageComposer']),
    );
    expect(slots.render).toHaveBeenCalledTimes(1);
    expect(slots.render.mock.calls[0][0].sourceTrait).toBe('OnPageComposer');
  });

  it('keeps every effect when no active set is given', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, undefined));
    result.current.applyClientEffects(
      [renderEffect('Anything'), renderEffect('AnythingElse')],
    );
    expect(slots.render).toHaveBeenCalledTimes(2);
  });

  it('still routes on-page embedded traits to the sidecar, not the slot', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, new Set(['EmbeddedAtom'])));
    result.current.applyClientEffects(
      [renderEffect('EmbeddedAtom')],
      undefined,
      undefined,
      new Set(['HostLayout', 'EmbeddedAtom']),
    );
    expect(slots.render).not.toHaveBeenCalled();
    expect(slots.updateTraitContent).toHaveBeenCalledTimes(1);
    expect(slots.updateTraitContent.mock.calls[0][0]).toBe('EmbeddedAtom');
  });
});

describe('useSlotFlush.flushSlot — grouped path (useClientTicks / useCallsiteCapture)', () => {
  const entry = (pattern: { type: string }): Parameters<SlotFlushHandle['flushSlot']>[2][number] =>
    ({ pattern: pattern as SlotPatternEntry['pattern'], props: {} });

  it('routes an embedded trait\'s grouped patterns to the sidecar, never the slot', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, new Set(['EmbeddedAtom'])));
    result.current.flushSlot('EmbeddedAtom', 'main', [entry({ type: 'box' }), entry({ type: 'stack' })]);
    expect(slots.render).not.toHaveBeenCalled();
    expect(slots.updateTraitContent).toHaveBeenCalledTimes(1);
    expect(slots.updateTraitContent.mock.calls[0][0]).toBe('EmbeddedAtom');
    // The grouped path collapses to the LAST pattern in the list.
    expect(slots.updateTraitContent.mock.calls[0][1].pattern).toBe('stack');
  });

  it('renders a non-embedded trait\'s grouped patterns into the named slot', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, new Set(['EmbeddedAtom'])));
    result.current.flushSlot('Composer', 'main', [entry({ type: 'stack' })], { event: 'INIT', state: 'idle', entity: 'Item' });
    expect(slots.updateTraitContent).not.toHaveBeenCalled();
    expect(slots.render).toHaveBeenCalledTimes(1);
    const write = slots.render.mock.calls[0][0];
    expect(write.target).toBe('main');
    expect(write.sourceTrait).toBe('Composer');
    expect(write.transitionEvent).toBe('INIT');
    expect(write.fromState).toBe('idle');
    expect(write.entity).toBe('Item');
  });

  it('clears the slot when the grouped pattern list is empty (clearSlot contract)', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, undefined));
    result.current.flushSlot('Composer', 'sidebar', []);
    expect(slots.render).not.toHaveBeenCalled();
    expect(slots.updateTraitContent).not.toHaveBeenCalled();
    expect(slots.clearBySource).toHaveBeenCalledWith('sidebar', 'Composer');
  });

  it('passes a bare @trait.X string pattern through as the props value (G-RUNTIME-025)', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, undefined));
    result.current.flushSlot('Composer', 'main', [
      { pattern: '@trait.Child', props: {} },
    ]);
    expect(slots.render).toHaveBeenCalledTimes(1);
    expect(slots.render.mock.calls[0][0].props).toBe('@trait.Child');
  });
});

