// @vitest-environment jsdom
/**
 * Regression coverage for the "two whole-orbital-imported pages stack their
 * full AppLayout in the same slot" bug (verified 2026-09-16 on project-friday
 * navigating Sprint -> Project -> Timesheets).
 *
 * `useTraitStateMachine`'s trait-bindings-changed effect (page navigation)
 * now diffs the previous render's active trait names against the new ones
 * and clears every dropped trait's slot contribution via `clearBySource`
 * before re-initializing — see `diffDroppedTraitNames` and the effect at
 * `hooks/useTraitStateMachine.ts` (the `[traitBindings]` `useEffect`).
 *
 * Coverage is in three layers: the exported pure diff function
 * (`diffDroppedTraitNames`); the real `useUISlotManager` mechanism the effect
 * relies on — `clearBySource` correctly un-stacking a multi-source slot
 * (`multi-source-slot-scope.test.ts`-style); and the wiring proof — mounting
 * the real `useTraitStateMachine` and swapping the active page's bindings
 * (the 910be296 refactor kept both helpers but deleted the call site, so
 * only a hook-level test catches that class of regression).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { diffDroppedTraitNames } from '../../src/hooks/useTraitStateMachine';
import { useTraitStateMachine } from '../../src/hooks/useTraitStateMachine';
import { useUISlotManager, ALL_SLOTS, type UISlotManager } from '../../src/hooks/useUISlots';
import type { OrbitalId, OrbitalSchema, ResolvedTraitBinding, Trait } from '@almadar/core';
import { createEmptyResolvedTrait } from '@almadar/core';

describe('diffDroppedTraitNames — pure trait-set diff', () => {
  it('names a trait present in prev but absent from next', () => {
    const dropped = diffDroppedTraitNames(
      new Set(['SprintOrbitalSprintAppLayout']),
      new Set(['ProjectOrbitalProjectAppLayout']),
    );
    expect(dropped).toEqual(['SprintOrbitalSprintAppLayout']);
  });

  it('names nothing when every previously-active trait is still active', () => {
    const dropped = diffDroppedTraitNames(
      new Set(['TraitA', 'TraitB']),
      new Set(['TraitA', 'TraitB', 'TraitC']),
    );
    expect(dropped).toEqual([]);
  });

  it('names every trait on the very first render (prev empty)', () => {
    expect(diffDroppedTraitNames(new Set(), new Set(['TraitA']))).toEqual([]);
  });

  it('names multiple dropped traits, in prev-set iteration order', () => {
    const dropped = diffDroppedTraitNames(
      new Set(['TaskOrbitalTaskAppLayout', 'TaskOrbitalTaskBoard']),
      new Set(['ProjectOrbitalProjectAppLayout']),
    );
    expect(dropped).toEqual(['TaskOrbitalTaskAppLayout', 'TaskOrbitalTaskBoard']);
  });
});

describe('clearBySource on a real UISlotManager — un-stacking a dropped trait', () => {
  it('a two-source stack collapses back to the remaining single source once the other is cleared', () => {
    const { result } = renderHook(() => useUISlotManager());

    act(() => {
      result.current.render({ target: 'main', pattern: 'app-layout', sourceTrait: 'SprintOrbitalSprintAppLayout' });
      result.current.render({ target: 'main', pattern: 'app-layout', sourceTrait: 'ProjectOrbitalProjectAppLayout' });
    });
    // Both traits legitimately active at once (e.g. mid-navigation) stack —
    // this is the exact shape the bug's live DOM capture showed
    // (`slot-content-stack-SprintOrbitalSprintAppLayout-ProjectOrbitalProjectAppLayout`).
    expect(result.current.slots['main']?.pattern).toBe('stack');

    act(() => {
      // What the fix's cleanup effect does for every dropped trait, across
      // every slot (`clearBySource` is a documented no-op for a slot the
      // trait never wrote to, so iterating ALL_SLOTS is safe — exercised
      // here too, not just the one slot that actually had content).
      for (const slot of ALL_SLOTS) {
        result.current.clearBySource(slot, 'SprintOrbitalSprintAppLayout');
      }
    });

    // No more stack — the remaining page's own AppLayout is the whole slot.
    const content = result.current.slots['main'];
    expect(content?.pattern).toBe('app-layout');
    expect(content?.sourceTrait).toBe('ProjectOrbitalProjectAppLayout');
  });

  it('clearing the trait that is the ONLY source empties the slot entirely', () => {
    const { result } = renderHook(() => useUISlotManager());

    act(() => {
      result.current.render({ target: 'main', pattern: 'app-layout', sourceTrait: 'TimesheetOrbitalTimesheetAppLayout' });
    });
    expect(result.current.slots['main']).not.toBeNull();

    act(() => {
      for (const slot of ALL_SLOTS) {
        result.current.clearBySource(slot, 'TimesheetOrbitalTimesheetAppLayout');
      }
    });

    expect(result.current.slots['main']).toBeNull();
  });
});

// Wiring proof: the pure diff + the manager mechanism above only matter if
// `useTraitStateMachine` actually CALLS them on a trait-set change (the
// 910be296 refactor kept both but deleted the call site, re-introducing the
// stacking this file exists to prevent). Mount the real hook, swap the
// active page's bindings, and assert the dropped trait gets cleared from
// every slot.
function wiringOrbitals(): OrbitalSchema['orbitals'] {
  const mkTrait = (name: string) => ({
    name,
    scope: 'instance' as const,
    linkedEntity: 'Item',
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }],
      events: [],
      transitions: [{ from: 'idle', to: 'idle', event: 'PING', effects: [] }],
    },
  });
  return [{
    name: 'NavOrbital',
    id: 'orb_nav' as OrbitalId,
    pages: [],
    entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [mkTrait('OldPageLayout'), mkTrait('NewPageLayout')],
  }];
}

// Variant whose NEW page trait owns a mount-lifecycle INIT with a render-ui
// effect, so the rerender actually paints into the slot — letting a test
// compare the cleanup's invocation order against the new page's first paint.
function wiringOrbitalsWithInit(): OrbitalSchema['orbitals'] {
  const mkTrait = (name: string, transitions: NonNullable<Trait['stateMachine']>['transitions']) => ({
    name,
    scope: 'instance' as const,
    linkedEntity: 'Item',
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }],
      events: [],
      transitions,
    },
  });
  return [{
    name: 'NavOrbital',
    id: 'orb_nav' as OrbitalId,
    pages: [],
    entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [
      mkTrait('OldPageLayout', [{ from: 'idle', to: 'idle', event: 'PING', effects: [] }]),
      mkTrait('NewPageLayout', [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'box' }]] }]),
    ],
  }];
}

function wiringBinding(name: string): ResolvedTraitBinding {
  const trait = createEmptyResolvedTrait(name, 'schema');
  trait.transitions = [{ from: 'idle', to: 'idle', event: 'PING', effects: [] }];
  return { trait, linkedEntity: 'Item' };
}

function stubSlots(): UISlotManager & { clearBySource: ReturnType<typeof vi.fn>; render: ReturnType<typeof vi.fn> } {
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

describe('useTraitStateMachine — dropped-trait slot cleanup wiring', () => {
  it('clears every slot for a trait dropped by a traitBindings change', () => {
    const slots = stubSlots();
    const orbitals = wiringOrbitals();
    const pageA = [wiringBinding('OldPageLayout')];
    const pageB = [wiringBinding('NewPageLayout')];

    const { rerender } = renderHook(
      ({ bindings }: { bindings: ResolvedTraitBinding[] }) =>
        useTraitStateMachine(bindings, slots, { orbitals }),
      { initialProps: { bindings: pageA } },
    );
    rerender({ bindings: pageB });

    const cleared = new Set(
      slots.clearBySource.mock.calls.map(([, traitName]) => traitName as string),
    );
    expect(cleared.has('OldPageLayout')).toBe(true);
    expect(cleared.has('NewPageLayout')).toBe(false);
    // Every slot is iterated (clearBySource is a documented no-op for slots
    // the trait never wrote to).
    for (const slot of ALL_SLOTS) {
      expect(
        slots.clearBySource.mock.calls.some(([s, t]) => s === slot && t === 'OldPageLayout'),
      ).toBe(true);
    }
  });

  it('clears nothing when the trait set is unchanged', () => {
    const slots = stubSlots();
    const orbitals = wiringOrbitals();
    const pageA = [wiringBinding('OldPageLayout')];

    const { rerender } = renderHook(
      ({ bindings }: { bindings: ResolvedTraitBinding[] }) =>
        useTraitStateMachine(bindings, slots, { orbitals }),
      { initialProps: { bindings: pageA } },
    );
    slots.clearBySource.mockClear();
    rerender({ bindings: pageA });

    expect(slots.clearBySource).not.toHaveBeenCalled();
  });

  // The stacking symptom is a RACE: the new page's INIT paint lands while
  // the old page's last render is still in the slot. The cleanup effect
  // runs earlier in the hook than the mount-lifecycle INIT effect, so the
  // clear must precede the first new-page paint — asserted here via vitest's
  // invocationCallOrder on the shared slot stub.
  it('clears the dropped trait BEFORE the new page\'s INIT paints into the slot', async () => {
    const slots = stubSlots();
    const orbitals = wiringOrbitalsWithInit();
    const pageA = [wiringBinding('OldPageLayout')];
    const pageB = [wiringBinding('NewPageLayout')];

    const { rerender } = renderHook(
      ({ bindings }: { bindings: ResolvedTraitBinding[] }) =>
        useTraitStateMachine(bindings, slots, { orbitals }),
      { initialProps: { bindings: pageA } },
    );

    await act(async () => {
      rerender({ bindings: pageB });
    });
    await vi.waitFor(() => {
      expect(slots.render).toHaveBeenCalled();
    });

    expect(slots.clearBySource).toHaveBeenCalledWith('main', 'OldPageLayout');
    const firstClear = slots.clearBySource.mock.invocationCallOrder[0];
    const firstPaint = slots.render.mock.invocationCallOrder[0];
    expect(firstClear).toBeDefined();
    expect(firstPaint).toBeDefined();
    expect(firstClear).toBeLessThan(firstPaint);
  });
});
