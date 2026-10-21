/**
 * One physical emit reaches a trait at most once per triggered event, however
 * many routes carry it: an embedded child's emit lands on the host's own key
 * (scope-chain bubbling) AND on the qualified key the host listens to. The
 * compiled tour heard each transport tick through both and advanced its
 * cursor twice. The runtime ingress already claims per (source, trait, event);
 * `useUIEvents` and compiled listens claim through the same owner.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import type { BusEventSource } from '@almadar/core';
import { EventBusProvider } from '../../core';
import { useEventBus } from '../../core';
import { useUIEvents } from '../useUIEvents';
import { claimDelivery } from '../../lib/bus-claim';

type Bus = ReturnType<typeof useEventBus>;

function Host({ onEvent, onBus }: { onEvent: (e: string) => void; onBus: (b: Bus) => void }) {
  const bus = useEventBus();
  useUIEvents((e: 'TICK') => onEvent(e), 'Orb.Host', ['TICK'] as const, bus);
  React.useEffect(() => bus.on('UI:Orb.Child.TICK', (event) => {
    if (claimDelivery(event.source, 'Orb.Host', 'TICK')) onEvent('TICK');
  }), [bus, onEvent]);
  React.useEffect(() => onBus(bus), [bus, onBus]);
  return null;
}

function setup() {
  const onEvent = vi.fn();
  let bus: Bus | undefined;
  render(<EventBusProvider debug={false}><Host onEvent={onEvent} onBus={(b) => { bus = b; }} /></EventBusProvider>);
  if (bus === undefined) throw new Error('no bus');
  return { onEvent, bus };
}

describe('at most once per physical emit', () => {
  it('the same emit on the host key and the listened key is handled once', () => {
    const { onEvent, bus } = setup();
    const source: BusEventSource = { orbital: 'Orb', trait: 'Child' };
    act(() => {
      bus.emit('UI:Orb.Child.TICK', {}, source);
      bus.emit('UI:Orb.Host.TICK', {}, source);
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('control: two separate emits are two deliveries', () => {
    const { onEvent, bus } = setup();
    act(() => {
      bus.emit('UI:Orb.Child.TICK', {}, { orbital: 'Orb', trait: 'Child' });
      bus.emit('UI:Orb.Child.TICK', {}, { orbital: 'Orb', trait: 'Child' });
    });
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('control: a sourceless emit is never deduplicated', () => {
    const { onEvent, bus } = setup();
    act(() => {
      bus.emit('UI:Orb.Host.TICK', {});
      bus.emit('UI:Orb.Host.TICK', {});
    });
    expect(onEvent).toHaveBeenCalledTimes(2);
  });
});
