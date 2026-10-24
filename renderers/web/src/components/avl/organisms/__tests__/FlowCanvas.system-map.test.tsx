// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { FlowCanvas } from '../FlowCanvas';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

const schema: OrbitalSchema = {
  name: 'Shop',
  orbitals: [
    {
      name: 'Catalog',
      entity: { name: 'Product', fields: [{ name: 'title', type: 'string', default: '' }] },
      pages: [{ name: 'CatalogPage', path: '/catalog', traits: [{ ref: 'Browse' }] }],
      traits: [
        {
          name: 'Browse',
          linkedEntity: 'Product',
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }],
            events: [{ key: 'INIT', name: 'Init' }],
            transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: 'Catalog' }]] }],
          },
        },
      ],
    },
  ],
};

function Recorder({ event, into }: { event: string; into: string[] }): null {
  const { on } = useEventBus();
  React.useEffect(() => on(`UI:${event}`, (e) => { into.push(String(e.payload?.orbital)); }), [on, event, into]);
  return null;
}

const renderMap = (systemMap: React.ComponentProps<typeof FlowCanvas>['systemMap'], seen: string[] = [], openTraitsEvent?: string) =>
  render(
    <EventBusProvider debug={false}>
      <Recorder event="OPEN_TRAITS" into={seen} />
      <FlowCanvas schema={schema} initialLevel="system" systemMap={systemMap} {...(openTraitsEvent ? { openTraitsEvent } : {})} width={800} height={600} />
    </EventBusProvider>,
  );

describe('FlowCanvas system map — declared drill and preview', () => {
  it('clicking an orbital emits the declared openTraitsEvent', async () => {
    const seen: string[] = [];
    renderMap({}, seen, 'OPEN_TRAITS');
    fireEvent.click(await screen.findByTestId('avl-system-node'));
    expect(seen).toEqual(['Catalog']);
  });

  it('Enter on a focused orbital drills the same way', async () => {
    const seen: string[] = [];
    renderMap({}, seen, 'OPEN_TRAITS');
    fireEvent.keyDown(await screen.findByTestId('avl-system-node'), { key: 'Enter' });
    expect(seen).toEqual(['Catalog']);
  });

  it('React hosts: the openTraits callback still runs, with or without the event', async () => {
    const called: string[] = [];
    renderMap({ openTraits: (o) => { called.push(o); } });
    fireEvent.click(await screen.findByTestId('avl-system-node'));
    expect(called).toEqual(['Catalog']);
  });

  it('control: a map with neither drill declared does not throw on click', async () => {
    const seen: string[] = [];
    renderMap({ highlighted: 'Catalog' }, seen);
    fireEvent.click(await screen.findByTestId('avl-system-node'));
    expect(seen).toEqual([]);
  });

  it('preview: true gives the orbital a hover card with its live screen', async () => {
    renderMap({ preview: true }, [], 'OPEN_TRAITS');
    fireEvent.mouseEnter(await screen.findByTestId('avl-system-node'));
    await waitFor(() => expect(screen.getByTestId('avl-system-preview')).toBeTruthy());
    expect(screen.getByTestId('avl-system-preview-screen')).toBeTruthy();
  });

  it('control: no preview and no renderPreview, no hover card', async () => {
    renderMap({}, [], 'OPEN_TRAITS');
    fireEvent.mouseEnter(await screen.findByTestId('avl-system-node'));
    expect(screen.queryByTestId('avl-system-preview')).toBeNull();
  });

  it('keyMap: Escape emits its declared event', async () => {
    const seen: string[] = [];
    render(
      <EventBusProvider debug={false}>
        <KeyRecorder event="ZOOM_OUT" into={seen} />
        <FlowCanvas schema={schema} initialLevel="system" keyMap={{ Escape: 'ZOOM_OUT' }} width={800} height={600} />
      </EventBusProvider>,
    );
    await screen.findByTestId('avl-system-node');
    fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' });
    expect(seen).toEqual(['ZOOM_OUT']);
  });

  it('control: no keyMap, Escape emits nothing', async () => {
    const seen: string[] = [];
    render(
      <EventBusProvider debug={false}>
        <KeyRecorder event="ZOOM_OUT" into={seen} />
        <FlowCanvas schema={schema} initialLevel="system" width={800} height={600} />
      </EventBusProvider>,
    );
    await screen.findByTestId('avl-system-node');
    fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' });
    expect(seen).toEqual([]);
  });
});

function KeyRecorder({ event, into }: { event: string; into: string[] }): null {
  const { on } = useEventBus();
  React.useEffect(() => on(`UI:${event}`, () => { into.push(event); }), [on, event, into]);
  return null;
}
