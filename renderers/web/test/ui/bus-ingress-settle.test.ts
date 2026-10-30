import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { TraitSurface } from '@almadar/core/kernel-wire';
import { useBusIngress, type BusDispatch, type BusEmitDelivery } from '../../src/hooks/circuit/useBusIngress';
import type { CircuitSurface } from '../../src/lib/circuit-surface';
import { useEventBus } from '../../src/core';

const pickerSurface: TraitSurface = {
  name: 'Picker',
  orbital: 'IngressOrbital',
  shared: false,
  browser: false,
  frameKey: 'Picker',
  ticks: [],
  emits: [],
  states: ['idle'],
  initial: 'idle',
  events: ['PICK'],
  listens: [],
  transitions: [{ from: 'idle', to: 'idle', event: 'PICK' }],
};

function binding(): ReadonlyMap<string, TraitSurface> {
  return new Map([['Picker', pickerSurface]]);
}

const circuit = (surfaces: ReadonlyMap<string, TraitSurface>): CircuitSurface => ({ byName: surfaces });

describe('useBusIngress', () => {
  it('settles a click, skips its own republished emit, hands a foreign one to the kernel', () => {
    const settle = vi.fn<BusDispatch>(async () => {});
    const deliver = vi.fn<BusEmitDelivery>(async () => {});
    const traitIndex = circuit(binding());
    const bindings = binding();
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
    const traitIndex = circuit(binding());
    const appTraitNames = new Set(['Picker', 'AuditList']);
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress(binding(), traitIndex, settle, deliver, bus.current, appTraitNames));

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
    renderHook(() => useBusIngress(binding(), circuit(binding()), settle, deliver, bus.current, new Set(['Picker', 'Ticker'])));
    const source = { trait: 'Ticker', tick: 'beat' };
    bus.current.emit('UI:PICK', { id: 'beat' }, source);
    expect(settle).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith({ event: 'PICK', payload: { id: 'beat' }, source });
  });

  it('edge: a sourceless bare emit goes to the kernel as an emit with no emitter', () => {
    const settle = vi.fn<BusDispatch>(async () => {});
    const deliver = vi.fn<BusEmitDelivery>(async () => {});
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress(binding(), circuit(binding()), settle, deliver, bus.current, new Set(['Picker', 'AuditList'])));
    bus.current.emit('UI:PICK', { id: 'click' });
    expect(settle).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith({ event: 'PICK', payload: { id: 'click' } });
  });

  it('control: an event no trait of the page names is subscribed by nobody', () => {
    const settle = vi.fn<BusDispatch>(async () => {});
    const deliver = vi.fn<BusEmitDelivery>(async () => {});
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress(binding(), circuit(binding()), settle, deliver, bus.current, new Set(['Picker'])));
    bus.current.emit('UI:UNRELATED', {});
    expect(settle).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('subscriptions come from the surface the kernel answers: its events and its listens, qualified by the source orbital', () => {
    const surfaces = new Map<string, TraitSurface>([['Picker', { ...pickerSurface, listens: [{ event: 'SPAWNED', source: { orbital: 'OtherOrbital', trait: 'Spawner' } }, { event: 'ANY' }] }]]);
    const settle = vi.fn<BusDispatch>(async () => {});
    const deliver = vi.fn<BusEmitDelivery>(async () => {});
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress(surfaces, circuit(surfaces), settle, deliver, bus.current, new Set(['Picker'])));

    bus.current.emit('UI:IngressOrbital.Picker.PICK', { id: 'late' });
    expect(settle).toHaveBeenCalledWith('Picker', 'PICK', { id: 'late' }, undefined);
    bus.current.emit('UI:OtherOrbital.Spawner.SPAWNED', { id: 's' });
    expect(settle).toHaveBeenCalledWith('Spawner', 'SPAWNED', { id: 's' }, undefined);
    bus.current.emit('UI:ANY', { id: 'a' });
    expect(deliver).toHaveBeenCalledWith({ event: 'ANY', payload: { id: 'a' } });
  });

  it('control: a circuit the kernel has not answered holds no trait, so nothing is subscribed', () => {
    const none = new Map<string, TraitSurface>();
    const settle = vi.fn<BusDispatch>(async () => {});
    const deliver = vi.fn<BusEmitDelivery>(async () => {});
    const { result: bus } = renderHook(() => useEventBus());
    renderHook(() => useBusIngress(none, circuit(none), settle, deliver, bus.current, new Set(['Picker'])));
    bus.current.emit('UI:IngressOrbital.Picker.PICK', { id: 'x' });
    bus.current.emit('UI:PICK', { id: 'y' });
    expect(settle).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});
