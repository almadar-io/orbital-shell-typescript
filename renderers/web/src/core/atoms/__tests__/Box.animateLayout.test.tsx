/**
 * `animateChanges` glides blocks that a change pushes: a step card grows and the
 * heading under it moves down over the theme's duration instead of jumping
 * (almadar.io rule/week/checks demos). jsdom lays nothing out: each pattern
 * block's top is driven here, and Element.animate is recorded.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { Box } from '../../index';
import { EventBusProvider } from '../../index';

const tops = new Map<string, number>();
let frameScale = 1;
const glides: Array<{ name: string; from: string }> = [];

beforeEach(() => {
  tops.clear();
  frameScale = 1;
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 300; } });
  glides.length = 0;
  document.documentElement.style.setProperty('--duration-normal', '250ms');
  document.documentElement.style.setProperty('--easing-emphasized', 'cubic-bezier(0.2, 0, 0, 1)');
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const name = this.getAttribute('data-name') ?? '';
    return new DOMRect(0, (tops.get(name) ?? 0) * frameScale, 300 * frameScale, 20 * frameScale);
  });
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element, frames: Keyframe[]) {
      const t = frames[0]?.transform;
      if (typeof t === 'string' && t.startsWith('translate(')) glides.push({ name: this.getAttribute('data-name') ?? '', from: t });
      return undefined;
    },
  });
});
afterEach(() => vi.restoreAllMocks());

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

function View({ detail }: { detail: string }) {
  return (
    <EventBusProvider debug={false}>
      <Box animateChanges>
        <div data-pattern="typography" style={{ display: 'contents' }}><p data-name="intro">{detail}</p></div>
        <div data-pattern="typography" style={{ display: 'contents' }}><h2 data-name="heading">Heading</h2></div>
      </Box>
    </EventBusProvider>
  );
}

describe('Box animateChanges: pushed blocks glide', () => {
  it('a block pushed down by a change above it glides from where it was', async () => {
    tops.set('heading', 40);
    const view = render(<View detail="short" />);
    await flush(); glides.length = 0;
    tops.set('heading', 56);
    view.rerender(<View detail="a much longer description" />);
    await flush();
    expect(glides).toContainEqual({ name: 'heading', from: 'translate(0px, -16px)' });
  });

  it('inside a frame scaled to half size the glide covers the full distance in layout pixels', async () => {
    frameScale = 0.5;
    tops.set('heading', 40);
    const view = render(<View detail="short" />);
    await flush(); glides.length = 0;
    tops.set('heading', 56);
    view.rerender(<View detail="a much longer description" />);
    await flush();
    expect(glides).toContainEqual({ name: 'heading', from: 'translate(0px, -16px)' });
  });

  it('control: a block that stays put does not glide', async () => {
    tops.set('heading', 40);
    const view = render(<View detail="short" />);
    await flush(); glides.length = 0;
    view.rerender(<View detail="other" />);
    await flush();
    expect(glides.filter((g) => g.name === 'heading')).toEqual([]);
  });
});
