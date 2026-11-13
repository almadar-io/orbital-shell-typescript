/**
 * One click on a guest control fans to a key per enclosing host trait scope, all with one `source`. Only the trait
 * that paints guest views hears it, as `<Painter>.<EVENT>`; no host trait reacts to the guest's event name.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import type { BusEventSource } from '@almadar/core';
import type { TraitSurface } from '@almadar/core/kernel-wire';
import { EventBusProvider, useRootEventBus } from '../../core';
import type { EventBusContextType } from '../../core';
import { useBusIngress } from '../circuit/useBusIngress';
import type { BusDispatch, BusEmitDelivery } from '../circuit/useBusIngress';
import type { CircuitSurface } from '../../lib/circuit-surface';

function surface(name: string, events: string[], paintsGuestViews: boolean): TraitSurface {
  return {
    name,
    orbital: 'Launchpad',
    shared: false,
    browser: false,
    frameKey: name,
    ticks: [],
    states: ['idle'],
    initial: 'idle',
    events,
    emits: [],
    listens: [],
    transitions: [],
    paintsGuestViews,
  };
}

const GUEST_KEYS = [
  'UI:OrbDesk.OrbConversation.ASK',
  'UI:Launchpad.GuestStage.ASK',
  'UI:Launchpad.LaunchpadStage.ASK',
  'UI:Launchpad.LaunchpadFrame.ASK',
];

function Probe(props: {
  stageEvents: string[];
  settle: BusDispatch;
  deliver: BusEmitDelivery;
  onBus: (bus: EventBusContextType) => void;
}) {
  const bus = useRootEventBus();
  const surfaces = React.useMemo(
    () =>
      new Map<string, TraitSurface>([
        ['GuestStage', surface('GuestStage', props.stageEvents, true)],
        ['LaunchpadStage', surface('LaunchpadStage', [], false)],
        ['LaunchpadFrame', surface('LaunchpadFrame', ['ASK'], false)],
      ]),
    [props.stageEvents],
  );
  const traitIndex = React.useMemo<CircuitSurface>(() => ({ byName: surfaces }), [surfaces]);
  const appTraitNames = React.useMemo(() => new Set(surfaces.keys()), [surfaces]);
  useBusIngress(surfaces, traitIndex, props.settle, props.deliver, bus, appTraitNames);
  React.useEffect(() => props.onBus(bus), [bus, props]);
  return null;
}

function setup(stageEvents: string[]) {
  const settle = vi.fn<BusDispatch>(() => Promise.resolve());
  const deliver = vi.fn<BusEmitDelivery>(() => Promise.resolve());
  let bus: EventBusContextType | undefined;
  render(
    <EventBusProvider debug={false}>
      <Probe stageEvents={stageEvents} settle={settle} deliver={deliver} onBus={(b) => { bus = b; }} />
    </EventBusProvider>,
  );
  if (bus === undefined) throw new Error('no bus');
  const live = bus;
  const emitAll = (keys: string[], source: BusEventSource) =>
    act(() => {
      for (const key of keys) live.emit(key, { text: 'hi' }, source);
    });
  return { settle, deliver, emitAll };
}

describe('a guest control inside a host trait', () => {
  it("a guest control's emit reaches only the guest painter's dispatch", async () => {
    const { settle, deliver, emitAll } = setup([]);
    const source: BusEventSource = {};
    emitAll(GUEST_KEYS, source);
    await Promise.resolve();
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith('GuestStage', 'OrbConversation.ASK', { text: 'hi' }, undefined);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("a guest control's emit is the guest's even when the painting trait declares the same event", async () => {
    const { settle, deliver, emitAll } = setup(['ASK']);
    const source: BusEventSource = {};
    emitAll(GUEST_KEYS, source);
    await Promise.resolve();
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith('GuestStage', 'OrbConversation.ASK', { text: 'hi' }, undefined);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("control: a host control's emit still dispatches its own trait", async () => {
    const { settle, emitAll } = setup([]);
    emitAll(['UI:Launchpad.LaunchpadFrame.ASK'], {});
    await Promise.resolve();
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith('LaunchpadFrame', 'ASK', { text: 'hi' }, undefined);
  });

  it("control: a later host emit is not treated as the guest's", async () => {
    const { settle, emitAll } = setup([]);
    emitAll(GUEST_KEYS, {});
    emitAll(['UI:Launchpad.LaunchpadFrame.ASK'], {});
    await Promise.resolve();
    expect(settle).toHaveBeenCalledTimes(2);
    expect(settle).toHaveBeenLastCalledWith('LaunchpadFrame', 'ASK', { text: 'hi' }, undefined);
  });
});
