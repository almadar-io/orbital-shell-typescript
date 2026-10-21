/**
 * A revealed section is a whole page band; holding `will-change` on it after
 * the reveal keeps a page-sized GPU layer alive, which makes mobile scrolling
 * janky. And CSS animations inside a band nobody can see should not run.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { createRequire } from 'node:module';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { AnimatedReveal } from '../../../../core';
import { EventBusProvider } from '../../../../core';

type Entry = { isIntersecting: boolean; intersectionRatio?: number; intersectionRect?: { height: number }; rootBounds?: { height: number } | null };
type Observer = { cb: (entries: Entry[]) => void; options: IntersectionObserverInit | undefined };

function stubObservers(): Observer[] {
  const made: Observer[] = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (entries: Entry[]) => void, options?: IntersectionObserverInit) { made.push({ cb, options }); }
    observe() { /* driven by the test */ }
    disconnect() { /* nothing to release */ }
  });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
  return made;
}

type Made = { options: IntersectionObserverInit | undefined };
const marginObserver = <O extends Made>(made: O[]) => made.find((o) => o.options?.rootMargin !== undefined);
const revealObserver = <O extends Made>(made: O[]) => made.find((o) => o.options?.rootMargin === undefined);

function mount() {
  const view = render(<EventBusProvider debug={false}><AnimatedReveal trigger="scroll">Band</AnimatedReveal></EventBusProvider>);
  const el = view.getByText('Band');
  return el;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('AnimatedReveal holds will-change only until it has revealed', () => {
  it('a section waiting to reveal keeps its layer hint', () => {
    stubObservers();
    expect(mount().style.willChange).toBe('opacity, transform');
  });

  it('a revealed section drops the layer hint', () => {
    const made = stubObservers();
    const el = mount();
    act(() => { revealObserver(made)?.cb([{ isIntersecting: true, intersectionRatio: 1, intersectionRect: { height: 100 }, rootBounds: { height: 800 } }]); });
    expect(el.style.willChange).toBe('auto');
  });

  it('control: the hint is never set as a permanent class', () => {
    stubObservers();
    expect(mount().className).not.toContain('will-change');
  });
});

describe('AnimatedReveal marks whether it is on screen', () => {
  it('watches with a margin so animations resume just before the band scrolls in', () => {
    const made = stubObservers();
    mount();
    expect(marginObserver(made)?.options?.rootMargin).toBe('200px');
  });

  it('marks the band off screen when it leaves and on screen when it returns', () => {
    const made = stubObservers();
    const el = mount();
    act(() => { marginObserver(made)?.cb([{ isIntersecting: false }]); });
    expect(el.getAttribute('data-on-screen')).toBe('false');
    act(() => { marginObserver(made)?.cb([{ isIntersecting: true }]); });
    expect(el.getAttribute('data-on-screen')).toBe('true');
  });

  it('control: before any observation the band is not marked off screen', () => {
    stubObservers();
    expect(mount().getAttribute('data-on-screen')).not.toBe('false');
  });
});

describe('the preset pauses animations inside an off-screen band', () => {
  it('emits a rule that pauses every descendant animation of an off-screen band', async () => {
    const require = createRequire(import.meta.url);
    const preset = require('../../../../../tailwind-preset.cjs');
    const config = { presets: [preset], content: [{ raw: '<div data-on-screen="false"></div>' }], corePlugins: { preflight: false } };
    const css = (await postcss([tailwindcss(config)]).process('@tailwind base;', { from: undefined })).css.replace(/\s+/g, ' ');
    expect(css).toMatch(/\[data-on-screen="false"\] \* \{ animation-play-state: paused !important \}/);
  });
});

type Seen = { isIntersecting: boolean; intersectionRatio: number; intersectionRect: { height: number }; rootBounds: { height: number } | null };
type SeenObserver = { cb: (entries: Seen[]) => void; options: IntersectionObserverInit | undefined };

function stubSeenObservers(): SeenObserver[] {
  const made: SeenObserver[] = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (entries: Seen[]) => void, options?: IntersectionObserverInit) { made.push({ cb, options }); }
    observe() { /* driven by the test */ }
    disconnect() { /* nothing to release */ }
  });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
  return made;
}

const VIEWPORT = 664;
const seen = (visiblePx: number, elementPx: number): Seen => ({
  isIntersecting: visiblePx > 0,
  intersectionRatio: visiblePx / elementPx,
  intersectionRect: { height: visiblePx },
  rootBounds: { height: VIEWPORT },
});

describe('AnimatedReveal reveals a band taller than the viewport', () => {
  it('reveals a 4538px band once its visible part fills the threshold share of the viewport', () => {
    const made = stubSeenObservers();
    const el = mount();
    act(() => { revealObserver(made)?.cb([seen(VIEWPORT, 4538)]); });
    expect(el.style.opacity).toBe('1');
  });

  it('control: a short element still needs the threshold share of itself visible', () => {
    const made = stubSeenObservers();
    const el = mount();
    act(() => { revealObserver(made)?.cb([seen(20, 200)]); });
    expect(el.style.opacity).toBe('0');
    act(() => { revealObserver(made)?.cb([seen(40, 200)]); });
    expect(el.style.opacity).toBe('1');
  });

  it('control: a tall band barely entering does not reveal yet', () => {
    const made = stubSeenObservers();
    const el = mount();
    act(() => { revealObserver(made)?.cb([seen(40, 4538)]); });
    expect(el.style.opacity).toBe('0');
  });

  it('watches thresholds below the configured one so a tall band reports as it scrolls in', () => {
    const made = stubSeenObservers();
    mount();
    const thresholds = revealObserver(made)?.options?.threshold;
    expect(Array.isArray(thresholds) && thresholds.length > 2 && thresholds.includes(0.15)).toBe(true);
  });
});
