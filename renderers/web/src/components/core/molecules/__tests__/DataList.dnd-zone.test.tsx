/**
 * A drop zone keeps its DOM node across renders. A zone that remounted on every render re-registered its droppable,
 * which re-rendered it again: on a kanban drag that loop ended in React error #185 (std-ats-recruiting pipeline).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DataList } from '../DataList';
import { EventBusProvider } from '../../../../core';

const fields = [{ name: 'name', variant: 'h4' as const }];
const rowsOf = () => [
  { id: '1', name: 'Jade' },
  { id: '2', name: 'Beacon' },
];

const board = (rows: ReturnType<typeof rowsOf>, accepts?: string) => (
  <EventBusProvider debug={false}>
    <DataList entity={rows} fields={fields} accepts={accepts} dragGroup={accepts ? 'applied' : undefined} dropEvent={accepts ? 'MOVE_CARD' : undefined} />
  </EventBusProvider>
);

describe('DataList drop zone', () => {
  it('keeps its zone element when it re-renders with the same rows', () => {
    const { container, rerender } = render(board(rowsOf(), '*'));
    const before = container.querySelector('[data-dnd-zone]');
    expect(before).not.toBeNull();
    rerender(board(rowsOf(), '*'));
    expect(container.querySelector('[data-dnd-zone]')).toBe(before);
  });

  it('control: a list that is no drop zone renders no zone element', () => {
    const { container } = render(board(rowsOf()));
    expect(container.querySelector('[data-dnd-zone]')).toBeNull();
  });
});
