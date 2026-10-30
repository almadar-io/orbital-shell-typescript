import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { OrbitalId, OrbitalSchema, ResolvedTraitBinding } from '@almadar/core';
import { createEmptyResolvedTrait } from '@almadar/core';
import { buildTraitIndex } from '../../src/runtime';
import { useBusIngress, type BusDispatch, type BusEmitDelivery } from '../../src/hooks/circuit/useBusIngress';
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
  it('settles a click, skips its own republished emit, hands a foreign one to the kernel', () => {
    const settle = vi.fn<BusDispatch>(async () => {});
    const deliver = vi.fn<BusEmitDelivery>(async () => {});
    const traitIndex = buildTraitIndex(orbitals());
    const bindings = [binding()];
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress(bindings, traitIndex, settle, deliver, bus.current, new Set(["Picker"])));

    bus.current.emit('UI:IngressOrbital.Picker.PICK', { id: 'a' });
    expect(settle).toHaveBeenCalledWith('Picker', 'PICK', { id: 'a' }, undefined);
    expect(deliver).not.toHaveBeenCalled();

    settle.mockClear();
    bus.current.emit('UI:PICK', { id: 'b' }, { trait: 'Picker', dispatched: true });
    expect(settle).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();

    const foreign = { trait: 'OtherHostTrait', dispatched: true };
    bus.current.emit('UI:PICK', { id: 'c' }, foreign);
    expect(settle).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith({ event: 'PICK', payload: { id: 'c' }, source: foreign });
  });

  it('an echo from an off-page trait of the SAME app is never re-delivered', () => {
    // std-contract: saving a contract cascades the off-page audit list's own
    // BrowseItemLoaded; the page's list must not render those rows.
    const settle = vi.fn<BusDispatch>(async () => {});
    const deliver = vi.fn<BusEmitDelivery>(async () => {});
    const traitIndex = buildTraitIndex(orbitals());
    const appTraitNames = new Set(['Picker', 'AuditList']);
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress([binding()], traitIndex, settle, deliver, bus.current, appTraitNames));

    bus.current.emit('UI:PICK', { id: 'audit' }, { trait: 'AuditList', dispatched: true });
    expect(settle).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();

    // Control: an echo from a host outside this app is the kernel's to route.
    bus.current.emit('UI:PICK', { id: 'other' }, { trait: 'OtherHostTrait', dispatched: true });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('a bare emit is never fanned to a trait by name: the kernel is handed it whole', () => {
    const settle = vi.fn<BusDispatch>(async () => {});
    const deliver = vi.fn<BusEmitDelivery>(async () => {});
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress([binding()], buildTraitIndex(orbitals()), settle, deliver, bus.current, new Set(['Picker', 'Ticker'])));
    const source = { trait: 'Ticker', tick: 'beat' };
    bus.current.emit('UI:PICK', { id: 'beat' }, source);
    expect(settle).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith({ event: 'PICK', payload: { id: 'beat' }, source });
  });

  it('edge: a sourceless bare emit goes to the kernel as an emit with no emitter', () => {
    const settle = vi.fn<BusDispatch>(async () => {});
    const deliver = vi.fn<BusEmitDelivery>(async () => {});
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress([binding()], buildTraitIndex(orbitals()), settle, deliver, bus.current, new Set(['Picker', 'AuditList'])));
    bus.current.emit('UI:PICK', { id: 'click' });
    expect(settle).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith({ event: 'PICK', payload: { id: 'click' } });
  });

  it('control: an event no trait of the page names is subscribed by nobody', () => {
    const settle = vi.fn<BusDispatch>(async () => {});
    const deliver = vi.fn<BusEmitDelivery>(async () => {});
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress([binding()], buildTraitIndex(orbitals()), settle, deliver, bus.current, new Set(['Picker'])));
    bus.current.emit('UI:UNRELATED', {});
    expect(settle).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});
