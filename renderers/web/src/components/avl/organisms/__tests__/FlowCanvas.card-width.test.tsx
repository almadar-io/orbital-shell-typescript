/**
 * A canvas card's frame width is a designer choice: it restores from the
 * saved placement and a resize is persisted alongside the card's position.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
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
  name: 'FixtureApp',
  orbitals: [
    {
      name: 'TaskBoard',
      entity: { name: 'Task', fields: [{ name: 'title', type: 'string' }] },
      pages: [{ name: 'TasksPage', path: '/tasks' }],
      traits: [
        {
          name: 'TaskList',
          scope: 'collection',
          linkedEntity: 'Task',
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }],
            events: [],
            transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'badge' }]] }],
          },
        },
      ],
    },
  ],
};

let emit: (type: string, payload: Record<string, string | number>) => void = () => {};
function BusHandle(): null {
  const bus = useEventBus();
  emit = (type, payload) => bus.emit(type, payload);
  return null;
}

function card(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[class*="@container/preview"]');
  if (!el) throw new Error('card not rendered');
  return el;
}

describe('FlowCanvas — card frame width', () => {
  it('a saved width sizes the card', async () => {
    const { container } = render(
      <EventBusProvider debug={false}>
        <FlowCanvas schema={schema} nodePositions={{ TaskBoard: { x: 0, y: 0, width: 520 } }} />
      </EventBusProvider>,
    );
    await waitFor(() => expect(card(container).style.width).toBe('520px'));
  });

  it('a resized card persists its width with every position', async () => {
    const onPositionsChange = vi.fn();
    const { container } = render(
      <EventBusProvider debug={false}>
        <BusHandle />
        <FlowCanvas schema={schema} nodePositions={{ TaskBoard: { x: 40, y: 60 } }} onPositionsChange={onPositionsChange} />
      </EventBusProvider>,
    );
    await waitFor(() => card(container));
    act(() => emit('UI:CANVAS_CARD_RESIZED', { nodeId: 'TaskBoard', width: 640 }));
    expect(onPositionsChange).toHaveBeenLastCalledWith({ TaskBoard: { x: 40, y: 60, width: 640 } });
    await waitFor(() => expect(card(container).style.width).toBe('640px'));
  });

  it('a resize of an unknown card changes nothing', async () => {
    const onPositionsChange = vi.fn();
    const { container } = render(
      <EventBusProvider debug={false}>
        <BusHandle />
        <FlowCanvas schema={schema} onPositionsChange={onPositionsChange} />
      </EventBusProvider>,
    );
    await waitFor(() => card(container));
    act(() => emit('UI:CANVAS_CARD_RESIZED', { nodeId: 'Nope', width: 640 }));
    expect(onPositionsChange).not.toHaveBeenCalled();
  });
});
