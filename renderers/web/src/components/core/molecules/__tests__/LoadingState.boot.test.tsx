import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LOADING_STATE_MARKER } from '@almadar/core';
import { LoadingState } from '../LoadingState';

describe('LoadingState boot loader (untilReady)', () => {
  it('drops the loading-state marker and carries data-orb-loader', () => {
    const { container } = render(<LoadingState untilReady messages={['a', 'b']} />);
    expect(container.querySelector(`[${LOADING_STATE_MARKER}]`)).toBeNull();
    expect(container.querySelector('[data-orb-loader]')).not.toBeNull();
  });

  it('control: a plain loading state keeps the marker and no loader attribute', () => {
    const { container } = render(<LoadingState message="x" />);
    expect(container.querySelector(`[${LOADING_STATE_MARKER}]`)).not.toBeNull();
    expect(container.querySelector('[data-orb-loader]')).toBeNull();
  });

  it('renders every message as its own line, the first one first', () => {
    const { container } = render(<LoadingState untilReady messages={['one', 'two', 'three']} />);
    const lines = Array.from(container.querySelectorAll('[data-orb-loader-line]')).map((el) => el.textContent);
    expect(lines).toEqual(['one', 'two', 'three']);
  });

  it('a single message does not rotate', () => {
    const { container } = render(<LoadingState untilReady messages={['only']} />);
    expect(container.querySelectorAll('[data-orb-loader-line]')).toHaveLength(1);
    expect(container.querySelector('style')?.textContent ?? '').not.toContain('orbLoaderLine');
  });

  it('shows that it is loading: animated dots and the status message, visible', () => {
    const { container } = render(<LoadingState untilReady messages={['q']} message="Loading" />);
    expect(container.querySelectorAll('[data-orb-loader-dots] i')).toHaveLength(3);
    expect(container.querySelector('[data-orb-loader-status]')?.textContent).toBe('Loading');
    expect(container.querySelector('style')?.textContent ?? '').toContain('@keyframes orbLoaderDot');
  });

  it('control: the status is not one of the rotating lines', () => {
    const { container } = render(<LoadingState untilReady messages={['q']} message="Loading" />);
    const lines = Array.from(container.querySelectorAll('[data-orb-loader-line]')).map((el) => el.textContent);
    expect(lines).toEqual(['q']);
  });

  it('several messages rotate on one cycle of messageMs each, with no script', () => {
    const { container } = render(<LoadingState untilReady messages={['a', 'b', 'c']} messageMs={4000} />);
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).toContain('@keyframes');
    expect(css).toContain('12000ms');
    expect(container.querySelector('script')).toBeNull();
  });

  it('the first line is fully up from the first frame: every line starts past its fade-in', () => {
    const { container } = render(<LoadingState untilReady messages={['a', 'b']} messageMs={4000} />);
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).toContain('[data-orb-loader-line="0"]{animation-delay:-400ms}');
    expect(css).toContain('[data-orb-loader-line="1"]{animation-delay:3600ms}');
  });

  it('hides once every scene canvas is ready, never while one is not', () => {
    const { container } = render(<LoadingState untilReady messages={['a']} />);
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).toContain('.orbital-scene-canvas[data-orb-ready="true"]');
    expect(css).toContain(':not(:has(.orbital-scene-canvas:not([data-orb-ready="true"])))');
  });

  it('paints the declared background and foreground', () => {
    const { container } = render(<LoadingState untilReady messages={['a']} background="#112233" foreground="#ffeedd" />);
    const el = container.querySelector('[data-orb-loader]');
    expect(el?.getAttribute('style') ?? '').toContain('background: rgb(17, 34, 51)');
    expect(el?.getAttribute('style') ?? '').toContain('color: rgb(255, 238, 221)');
  });
});
