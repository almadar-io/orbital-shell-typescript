import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { EventPayload } from '@almadar/core';
import { EventBusProvider, useEventBus } from '../../../../core';
import { AnnotatedMedia } from '../AnnotatedMedia';

type Seen = { name: string; payload: EventPayload }[];

function Recorder({ into }: { into: Seen }): null {
  const { on } = useEventBus();
  React.useEffect(() => {
    const offs = ['UI:PLACE', 'UI:PICK'].map((name) => on(name, (e) => { into.push({ name, payload: e.payload ?? {} }); }));
    return () => offs.forEach((off) => off());
  }, [on, into]);
  return null;
}

function mount(node: React.ReactNode, seen: Seen) {
  return render(<EventBusProvider debug={false}><Recorder into={seen} />{node}</EventBusProvider>);
}

function sizeRegion(): HTMLElement {
  const region = screen.getByRole('region');
  region.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 200, right: 500, bottom: 250, x: 100, y: 50, toJSON: () => ({}) });
  return region;
}

afterEach(cleanup);

describe('AnnotatedMedia (image)', () => {
  it('a click on the media places a pin at the clicked spot, as percentages', () => {
    const seen: Seen = [];
    mount(<AnnotatedMedia src="/design.png" placeEvent="PLACE" pinSelectEvent="PICK" />, seen);
    fireEvent.click(sizeRegion(), { clientX: 200, clientY: 100 });
    expect(seen).toEqual([{ name: 'UI:PLACE', payload: { x: 25, y: 25, time: 0 } }]);
  });

  it('control: with placing off a click places nothing', () => {
    const seen: Seen = [];
    mount(<AnnotatedMedia src="/design.png" placing={false} placeEvent="PLACE" />, seen);
    fireEvent.click(sizeRegion(), { clientX: 200, clientY: 100 });
    expect(seen).toEqual([]);
  });

  it('draws pins numbered in order and a pin click selects it without placing a new one', () => {
    const seen: Seen = [];
    mount(
      <AnnotatedMedia
        src="/design.png"
        placeEvent="PLACE"
        pinSelectEvent="PICK"
        pins={[{ id: 'a', x: 10, y: 20, label: 'Logo too small' }, { id: 'b', x: 60, y: 40, resolved: true }]}
      />,
      seen,
    );
    sizeRegion();
    expect(screen.getByRole('button', { name: 'Logo too small' }).textContent).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(seen).toEqual([{ name: 'UI:PICK', payload: { id: 'b' } }]);
  });

  it('control: a pin with no position is not drawn on the media', () => {
    mount(<AnnotatedMedia src="/design.png" pins={[{ id: 'a', time: 3 }]} />, []);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
