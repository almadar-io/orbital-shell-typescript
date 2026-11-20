// @vitest-environment jsdom
/**
 * A kanban board (scrollX) pans sideways when the viewer holds the mouse on its empty space and drags, Trello style.
 * The mouse wheel is left alone (it scrolls a column or the page), and a trackpad's sideways swipe stays the browser's.
 */
import React from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { DataGrid } from '../DataGrid';
import { EventBusProvider } from '../../../../core';

afterEach(cleanup);

const rows = [{ id: 'a', name: 'Backlog' }, { id: 'b', name: 'Doing' }, { id: 'c', name: 'Done' }];

function board(scrollX = true) {
  const { container } = render(
    <EventBusProvider>
      <DataGrid entity={rows} fields={[{ name: 'name' }]} scrollX={scrollX} minCardWidth={300} />
    </EventBusProvider>,
  );
  const grid = container.querySelector<HTMLElement>('[data-grid-layout="cards"]');
  if (grid === null) throw new Error('no grid');
  Object.defineProperty(grid, 'scrollWidth', { configurable: true, value: 1500 });
  Object.defineProperty(grid, 'clientWidth', { configurable: true, value: 800 });
  grid.scrollLeft = 200;
  return grid;
}

describe('DataGrid scrollX board drag to pan', () => {
  it('holding the mouse on the board and dragging left pans it right', () => {
    const grid = board();
    fireEvent.mouseDown(grid, { button: 0, clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 400 });
    fireEvent.mouseUp(window, { clientX: 400 });
    expect(grid.scrollLeft).toBe(300);
  });

  it('a drag does not end in a click on what it was released over', () => {
    const grid = board();
    fireEvent.mouseDown(grid, { button: 0, clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 450 });
    fireEvent.mouseUp(window, { clientX: 450 });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    grid.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('control: a press on a card or a button inside the board does not pan', () => {
    const grid = board();
    const card = document.createElement('div');
    card.setAttribute('data-dnd-item', '');
    const button = document.createElement('button');
    grid.append(card, button);
    for (const target of [card, button]) {
      fireEvent.mouseDown(target, { button: 0, clientX: 500 });
      fireEvent.mouseMove(window, { clientX: 300 });
      fireEvent.mouseUp(window, { clientX: 300 });
    }
    expect(grid.scrollLeft).toBe(200);
  });

  it('control: the mouse wheel no longer moves the board sideways', () => {
    const grid = board();
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    grid.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(grid.scrollLeft).toBe(200);
  });

  it('edge: a right-button press does not pan', () => {
    const grid = board();
    fireEvent.mouseDown(grid, { button: 2, clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 300 });
    fireEvent.mouseUp(window, { clientX: 300 });
    expect(grid.scrollLeft).toBe(200);
  });

  it('control: a wrapping grid never pans', () => {
    const grid = board(false);
    fireEvent.mouseDown(grid, { button: 0, clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 300 });
    fireEvent.mouseUp(window, { clientX: 300 });
    expect(grid.scrollLeft).toBe(200);
  });
});
