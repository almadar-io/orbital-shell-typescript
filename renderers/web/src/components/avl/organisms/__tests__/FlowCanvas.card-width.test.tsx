/**
 * A canvas card's frame width is a designer choice: it restores from the
 * saved placement and a resize is persisted alongside the card's position.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { FlowCanvas } from '../FlowCanvas';
import { EventBusProvider } from '../../../../core';

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

// A card's right-edge resize control, standing in for the library's pointer drag geometry: one click ends a resize at `resizeTo`.
let resizeTo = 0;
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    NodeResizeControl: ({ onResizeEnd }: { onResizeEnd?: (event: unknown, params: { width: number }) => void }) => (
      <button type="button" data-testid="card-resize" onClick={() => onResizeEnd?.(null, { width: resizeTo })} />
    ),
  };
});

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
        <FlowCanvas schema={schema} nodePositions={{ TaskBoard: { x: 40, y: 60 } }} onPositionsChange={onPositionsChange} />
      </EventBusProvider>,
    );
    await waitFor(() => card(container));
    resizeTo = 640;
    fireEvent.click(screen.getByTestId('card-resize'));
    expect(onPositionsChange).toHaveBeenLastCalledWith({ TaskBoard: { x: 40, y: 60, width: 640 } });
    await waitFor(() => expect(card(container).style.width).toBe('640px'));
  });
});
