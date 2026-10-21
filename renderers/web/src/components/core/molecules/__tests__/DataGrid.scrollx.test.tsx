/**
 * G-UI-035 — a kanban board (scrollX) on a narrow screen must show that more
 * columns exist: each column is capped below the board width so the next one
 * peeks in, and columns snap as the board scrolls.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DataGrid } from '../DataGrid';
import { EventBusProvider } from '../../../../core';

const rows = [{ id: 'a', name: 'Backlog' }, { id: 'b', name: 'Doing' }, { id: 'c', name: 'Done' }];
const withBus = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

describe('DataGrid scrollX board', () => {
  it('caps each column below the board width so the next column peeks in', () => {
    const { container } = withBus(<DataGrid entity={rows} fields={[{ name: 'name' }]} scrollX minCardWidth={300} />);
    const grid = container.querySelector<HTMLElement>('.grid-flow-col');
    expect(grid?.style.gridAutoColumns).toBe('minmax(min(300px, 85%), 1fr)');
  });

  it('snaps columns while scrolling', () => {
    const { container } = withBus(<DataGrid entity={rows} fields={[{ name: 'name' }]} scrollX />);
    const grid = container.querySelector<HTMLElement>('.grid-flow-col');
    // Snap on every direct child, whatever wraps the card (a DnD SortableItem).
    expect(grid?.className).toContain('snap-x');
    expect(grid?.className).toContain('[&>*]:snap-start');
  });

  it('control: a wrapping grid neither snaps nor caps columns', () => {
    const { container } = withBus(<DataGrid entity={rows} fields={[{ name: 'name' }]} />);
    expect(container.querySelector('.snap-x')).toBeNull();
    expect(container.querySelector('.grid-flow-col')).toBeNull();
  });
});
