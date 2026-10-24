import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { OrbitalId, OrbitalSchema, ResolvedTraitBinding } from '@almadar/core';
import { createEmptyResolvedTrait } from '@almadar/core';
import { buildTraitIndex } from '../../src/runtime';
import { useBusIngress, type BusDispatch } from '../../src/hooks/circuit/useBusIngress';
import { useEventBus } from '../../src/core';

function orbitals(): OrbitalSchema['orbitals'] {
  return [{
    name: 'IngressOrbital',
    id: 'orb_ingress' as OrbitalId,
    pages: [],
    entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [{
      name: 'Picker',
      linkedEntity: 'Item',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [{ from: 'idle', to: 'idle', event: 'PICK', effects: [] }],
      },
    }],
  }];
}

function binding(): ResolvedTraitBinding {
  const trait = createEmptyResolvedTrait('Picker', 'schema');
  trait.transitions = [{ from: 'idle', to: 'idle', event: 'PICK', effects: [] }];
  return { trait, linkedEntity: 'Item' };
}

describe('useBusIngress', () => {
  it('settles a click, skips its own republished emit, accepts a foreign one', () => {
    const settle = vi.fn<BusDispatch>(async () => {});
    const traitIndex = buildTraitIndex(orbitals());
    const bindings = [binding()];
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress(bindings, traitIndex, settle, bus.current, new Set(["Picker"])));

    bus.current.emit('UI:IngressOrbital.Picker.PICK', { id: 'a' });
    expect(settle).toHaveBeenCalledWith('Picker', 'PICK', { id: 'a' }, undefined);

    settle.mockClear();
    bus.current.emit('UI:PICK', { id: 'b' }, { trait: 'Picker', dispatched: true });
    expect(settle).not.toHaveBeenCalled();

    bus.current.emit('UI:PICK', { id: 'c' }, { trait: 'OtherHostTrait', dispatched: true });
    expect(settle).toHaveBeenCalledWith('Picker', 'PICK', { id: 'c' }, undefined);
  });

  it('an echo from an off-page trait of the SAME app is never re-delivered by bare name', () => {
    // std-contract: saving a contract cascades the off-page audit list's own
    // BrowseItemLoaded; the page's list must not render those rows.
    const settle = vi.fn<BusDispatch>(async () => {});
    const traitIndex = buildTraitIndex(orbitals());
    const appTraitNames = new Set(['Picker', 'AuditList']);
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress([binding()], traitIndex, settle, bus.current, appTraitNames));

    bus.current.emit('UI:PICK', { id: 'audit' }, { trait: 'AuditList', dispatched: true });
    expect(settle).not.toHaveBeenCalled();

    // Control: an echo from a host outside this app still arrives by name.
    bus.current.emit('UI:PICK', { id: 'other' }, { trait: 'OtherHostTrait', dispatched: true });
    expect(settle).toHaveBeenCalledWith('Picker', 'PICK', { id: 'other' }, undefined);
  });

  it('a tick emit does not reach a sibling that only has an arm of that name (G-UI-103 retired)', () => {
    const settle = vi.fn<BusDispatch>(async () => {});
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress([binding()], buildTraitIndex(orbitals()), settle, bus.current, new Set(['Picker', 'Ticker'])));
    bus.current.emit('UI:PICK', { id: 'beat' }, { trait: 'Ticker', tick: 'beat' });
    expect(settle).not.toHaveBeenCalled();
  });

  it('control: a trait\'s own tick emit still reaches its own arm', () => {
    const settle = vi.fn<BusDispatch>(async () => {});
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress([binding()], buildTraitIndex(orbitals()), settle, bus.current, new Set(['Picker'])));
    bus.current.emit('UI:PICK', { id: 'beat' }, { trait: 'Picker', tick: 'beat' });
    expect(settle).toHaveBeenCalledWith('Picker', 'PICK', { id: 'beat' }, 'beat');
  });

  it('edge: a user event (not a server echo) still reaches the trait by bare name', () => {
    const settle = vi.fn<BusDispatch>(async () => {});
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress([binding()], buildTraitIndex(orbitals()), settle, bus.current, new Set(['Picker', 'AuditList'])));
    bus.current.emit('UI:PICK', { id: 'click' });
    expect(settle).toHaveBeenCalledWith('Picker', 'PICK', { id: 'click' }, undefined);
  });
});
