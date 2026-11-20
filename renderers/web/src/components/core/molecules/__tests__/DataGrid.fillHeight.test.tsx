// @vitest-environment jsdom
/**
 * A kanban board (scrollX) with fillHeight runs from where it starts to the bottom of the screen, Trello style: its
 * columns keep to that height and scroll their own cards, so the board's sideways scrollbar stays on screen.
 */
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { DataGrid } from '../DataGrid';
import { EventBusProvider } from '../../../../core';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rows = [{ id: 'a', name: 'Backlog' }, { id: 'b', name: 'Doing' }];

function boardAt(top: number, viewport: number, props: Partial<React.ComponentProps<typeof DataGrid>> = {}) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: viewport });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }),
  );
  const { container } = render(
    <EventBusProvider>
      <DataGrid entity={rows} fields={[{ name: 'name' }]} scrollX minCardWidth={300} {...props} />
    </EventBusProvider>,
  );
  const grid = container.querySelector<HTMLElement>('[data-grid-layout="cards"]');
  if (grid === null) throw new Error('no grid');
  return grid;
}

describe('DataGrid fillHeight board', () => {
  it('runs from its top to the bottom of the screen and lets each column scroll inside it', () => {
    const grid = boardAt(200, 900, { fillHeight: true });
    expect(grid.style.height).toBe('684px');
    expect(grid.className).toContain('items-start');
  });

  it('follows a resized window', () => {
    const grid = boardAt(200, 900, { fillHeight: true });
    act(() => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 1100 });
      window.dispatchEvent(new Event('resize'));
    });
    expect(grid.style.height).toBe('884px');
  });

  it('edge: with little room left it keeps a usable height', () => {
    const grid = boardAt(700, 800, { fillHeight: true });
    expect(grid.style.height).toBe('320px');
  });

  it('control: without fillHeight the board takes its content height', () => {
    const grid = boardAt(200, 900);
    expect(grid.style.height).toBe('');
  });
});
