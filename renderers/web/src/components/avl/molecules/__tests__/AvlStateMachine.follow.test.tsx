// @vitest-environment jsdom
/**
 * followActive keeps the active state in view: when it changes, the diagram's own horizontal
 * scroller moves so that state sits in the middle. Off by default; it never touches the page.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AvlStateMachine } from '../AvlStateMachine';
import type { TraitLevelData } from '../../../../lib/avl-schema-parser';

const FLOW: TraitLevelData = {
  name: 'Flow',
  linkedEntity: 'Item',
  states: [
    { name: 'a', isInitial: true, isTerminal: false },
    { name: 'b', isInitial: false, isTerminal: false },
    { name: 'c', isInitial: false, isTerminal: false },
  ],
  transitions: [
    { from: 'a', to: 'b', event: 'NEXT', guard: null, effects: [], index: 0 },
    { from: 'b', to: 'c', event: 'NEXT', guard: null, effects: [], index: 1 },
  ],
  emittedEvents: [],
  listenedEvents: [],
};

// The scroller is 300px wide at x=0; state `a` is drawn at x=40, `c` at x=700 (each 100px wide).
const NODE_X: Record<string, number> = { a: 40, b: 370, c: 700 };
let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollTo = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
    const state = this.dataset.state;
    const x = state !== undefined ? NODE_X[state] ?? 0 : 0;
    const width = state !== undefined ? 100 : 300;
    return { x, left: x, width, right: x + width, top: 0, y: 0, height: 40, bottom: 40, toJSON: () => ({}) };
  });
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: SVGElement) {
    const state = this.getAttribute('data-state');
    const x = state !== null ? NODE_X[state] ?? 0 : 0;
    return { x, left: x, width: 100, right: x + 100, top: 0, y: 0, height: 40, bottom: 40, toJSON: () => ({}) };
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
});

afterEach(() => vi.restoreAllMocks());

async function draw(props: Partial<React.ComponentProps<typeof AvlStateMachine>>) {
  const utils = render(<AvlStateMachine trait={FLOW} {...props} />);
  await waitFor(() => expect(screen.getAllByTestId('avl-sm-state')).toHaveLength(3));
  return utils;
}

describe('AvlStateMachine followActive', () => {
  it('centres the active state in its scroller when the state changes', async () => {
    const { rerender } = await draw({ followActive: true, activeState: 'a' });
    rerender(<AvlStateMachine trait={FLOW} followActive activeState="c" />);
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ left: 600 })));
  });

  it('control: without followActive nothing scrolls', async () => {
    const { rerender } = await draw({ activeState: 'a' });
    rerender(<AvlStateMachine trait={FLOW} activeState="c" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('edge: a state already left of centre scrolls back, never past the start', async () => {
    const { rerender } = await draw({ followActive: true, activeState: 'c' });
    rerender(<AvlStateMachine trait={FLOW} followActive activeState="a" />);
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ left: 0 })));
  });
});
