/**
 * A `fixed` panel with an automatic width shrinks to the room left of its `left`
 * edge, so a panel pushed back from the viewport edge used to measure narrower,
 * move, measure again and loop past React's update limit (#185). The browser's
 * sizing is modelled here: the panel's width follows its placement unless the
 * panel sizes itself to its content.
 */
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Popover } from '../Popover';

const NATURAL_WIDTH = 600;
const NATURAL_HEIGHT = 200;
const EDGE = 8;

function laidOutWidth(el: HTMLElement): number {
  if (el.getAttribute('role') !== 'dialog') return 0;
  if (el.style.width === 'max-content') {
    return Math.min(NATURAL_WIDTH, window.innerWidth - 2 * EDGE);
  }
  const left = Number.parseFloat(el.style.left || '0');
  return Math.max(0, Math.min(NATURAL_WIDTH, window.innerWidth - left));
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return laidOutWidth(this);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'dialog' ? NATURAL_HEIGHT : 0;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function triggerAt(left: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(left, 100, 40, 20),
  );
}

it('a wide hover panel opened at the right edge settles flush with the edge instead of looping', () => {
  triggerAt(window.innerWidth - 60);
  render(
    <Popover trigger="hover" content={<div data-testid="wide">wide</div>}>
      <button>box</button>
    </Popover>,
  );
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'box' }));
  const panel = screen.getByRole('dialog');
  expect(panel.offsetWidth).toBe(NATURAL_WIDTH);
  expect(Number.parseFloat(panel.style.left)).toBe(window.innerWidth - NATURAL_WIDTH - EDGE);
});

it('control: a panel opened mid-screen keeps its natural width and centres under the trigger', () => {
  triggerAt(400);
  render(
    <Popover trigger="hover" content={<div>wide</div>}>
      <button>box</button>
    </Popover>,
  );
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'box' }));
  const panel = screen.getByRole('dialog');
  expect(panel.offsetWidth).toBe(NATURAL_WIDTH);
  expect(Number.parseFloat(panel.style.left)).toBe(420 - NATURAL_WIDTH / 2);
});

it('edge: a panel wider than the viewport is capped to the viewport less both edges', () => {
  triggerAt(10);
  const wide = window.innerWidth + 400;
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute('role') !== 'dialog') return 0;
    return this.style.width === 'max-content'
      ? Math.min(wide, window.innerWidth - 2 * EDGE)
      : Math.min(wide, window.innerWidth - Number.parseFloat(this.style.left || '0'));
  });
  render(
    <Popover trigger="hover" content={<div>wider than the screen</div>}>
      <button>box</button>
    </Popover>,
  );
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'box' }));
  const panel = screen.getByRole('dialog');
  expect(panel.offsetWidth).toBe(window.innerWidth - 2 * EDGE);
  expect(Number.parseFloat(panel.style.left)).toBe(EDGE);
});
