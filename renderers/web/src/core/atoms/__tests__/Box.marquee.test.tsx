import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Box } from '../Box';

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const strip = <span>Physics</span>;

describe('Box marquee paints the declared strip', () => {
  beforeEach(() => {
    setReducedMotion(false);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 40));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('a looping strip repeats its content once, moves one copy width per loop at the declared speed, and clips', () => {
    const { container } = render(<Box marquee={{ direction: 'start', speed: 30, clip: true, loop: true }}>{strip}</Box>);
    const track = container.querySelector<HTMLElement>('[data-marquee-track]');
    expect(track?.children).toHaveLength(2);
    expect(track?.children[1].getAttribute('aria-hidden')).toBe('true');
    expect(track?.style.animation).toContain('20s');
    expect(track?.style.animationDirection).toBe('normal');
    expect(track?.style.getPropertyValue('--marquee-distance')).toBe('50%');
    expect(container.firstElementChild?.className).toContain('proof-marquee');
  });

  it('moving toward the end reverses, and a strip without loop has one copy that travels its full width', () => {
    const { container } = render(<Box marquee={{ direction: 'end', speed: 60, clip: false, loop: false }}>{strip}</Box>);
    const track = container.querySelector<HTMLElement>('[data-marquee-track]');
    expect(track?.children).toHaveLength(1);
    expect(track?.style.animationDirection).toBe('reverse');
    expect(track?.style.getPropertyValue('--marquee-distance')).toBe('100%');
    expect(container.firstElementChild?.className).not.toContain('proof-marquee');
  });

  it('control: under reduced motion the strip stands still, wraps and is not repeated', () => {
    setReducedMotion(true);
    const { container } = render(<Box marquee={{ direction: 'start', speed: 30, clip: true, loop: true }}>{strip}</Box>);
    const track = container.querySelector<HTMLElement>('[data-marquee-track]');
    expect(track?.children).toHaveLength(1);
    expect(track?.style.animation).toBe('');
    expect(track?.className).toContain('flex-wrap');
  });

  it('control: a box without marquee renders its children directly', () => {
    const { container } = render(<Box>{strip}</Box>);
    expect(container.querySelector('[data-marquee-track]')).toBeNull();
  });
});
