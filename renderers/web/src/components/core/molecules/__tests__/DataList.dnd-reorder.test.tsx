/**
 * DataList same-column reorder — what a sortable drop puts on the bus.
 *
 * A trait persists a reorder through `positionEvent` (one `{ id, position }`
 * per item, the whole column renumbered); `reorderEvent` is a notification
 * of the moved card only. std-board relies on this split: its REORDER_CARD
 * arm is bodiless and REORDER_POSITION persists. `DndContext` is mocked to
 * capture its handlers, as in `useCanvasDnd.test.tsx`.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import type { Active, DragEndEvent, DragOverEvent, Over } from '@dnd-kit/core';
import { DataList } from '../DataList';
import { EventBusProvider } from '../../../../core';
import { type BusEvent } from '@almadar/core';
import { useEventBus } from '../../../../core';

let onDragOver: ((event: DragOverEvent) => void) | undefined;
let onDragEnd: ((event: DragEndEvent) => void) | undefined;

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: (props: {
      children: React.ReactNode;
      onDragOver?: (event: DragOverEvent) => void;
      onDragEnd?: (event: DragEndEvent) => void;
    }) => {
      onDragOver = props.onDragOver;
      onDragEnd = props.onDragEnd;
      return props.children;
    },
  };
});

const rows = [
  { id: 'a', title: 'A' },
  { id: 'b', title: 'B' },
  { id: 'c', title: 'C' },
];

function Listener({ events }: { events: BusEvent[] }): null {
  const { on } = useEventBus();
  React.useEffect(() => {
    const offs = ['UI:REORDER_CARD', 'UI:REORDER_POSITION', 'UI:MOVE_CARD'].map((t) =>
      on(t, (e) => events.push(e)),
    );
    return () => offs.forEach((off) => off());
  }, [on, events]);
  return null;
}

function active(id: string): Active {
  return { id, data: { current: { dndGroup: 'todo' } }, rect: { current: { initial: null, translated: null } } };
}

function over(id: string): Over {
  return {
    id,
    rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
    disabled: false,
    data: { current: { dndGroup: 'todo' } },
  };
}

function mount(props: { positionEvent?: string }): BusEvent[] {
  const events: BusEvent[] = [];
  render(
    <EventBusProvider>
      <Listener events={events} />
      <DataList
        entity={rows}
        fields={[{ name: 'title' }]}
        sortable
        dragGroup="todo"
        accepts="*"
        dropEvent="MOVE_CARD"
        reorderEvent="REORDER_CARD"
        {...props}
      />
    </EventBusProvider>,
  );
  return events;
}

function dragCOntoA(): void {
  const activatorEvent = new MouseEvent('pointerdown');
  const base = { active: active('c'), over: over('a'), collisions: null, delta: { x: 0, y: -80 }, activatorEvent };
  act(() => onDragOver?.(base));
  act(() => onDragEnd?.(base));
}

describe('DataList same-column reorder', () => {
  afterEach(() => {
    onDragOver = undefined;
    onDragEnd = undefined;
    cleanup();
  });

  it('emits reorderEvent for the moved card and positionEvent for every card in the new order', () => {
    const events = mount({ positionEvent: 'REORDER_POSITION' });
    dragCOntoA();

    expect(events.filter((e) => e.type === 'UI:REORDER_CARD').map((e) => e.payload)).toEqual([
      { id: 'c', oldIndex: 2, newIndex: 0 },
    ]);
    expect(events.filter((e) => e.type === 'UI:REORDER_POSITION').map((e) => e.payload)).toEqual([
      { id: 'c', position: 0 },
      { id: 'a', position: 1000 },
      { id: 'b', position: 2000 },
    ]);
    expect(events.some((e) => e.type === 'UI:MOVE_CARD')).toBe(false);
  });

  it('control: without positionEvent only the reorder notification is emitted', () => {
    const events = mount({});
    dragCOntoA();

    expect(events.map((e) => e.type)).toEqual(['UI:REORDER_CARD']);
  });
});
