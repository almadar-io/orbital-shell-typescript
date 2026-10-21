import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConfettiEffect } from '../../index';
import { TypewriterText } from '../../index';
import { AnimatedReveal } from '../../index';
import { EventBusProvider } from '../../index';
import { useEventBus } from '../../index';

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

type ObservedEntry = { isIntersecting: boolean; intersectionRatio: number; intersectionRect: { height: number }; rootBounds: { height: number } };
/** A whole element in or out of an 800px viewport. */
const observed = (isIntersecting: boolean): ObservedEntry => ({
  isIntersecting,
  intersectionRatio: isIntersecting ? 1 : 0,
  intersectionRect: { height: isIntersecting ? 100 : 0 },
  rootBounds: { height: 800 },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ConfettiEffect', () => {
  it('control: bursts particles when motion is allowed', () => {
    setReducedMotion(false);
    const { container } = render(<ConfettiEffect trigger particleCount={5} />);
    expect(container.querySelectorAll('[style*="confetti-burst"]').length).toBe(5);
  });

  it('spawns nothing under prefers-reduced-motion', () => {
    setReducedMotion(true);
    const { container } = render(<ConfettiEffect trigger particleCount={5} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('TypewriterText', () => {
  it('control: reveals character by character when motion is allowed', () => {
    setReducedMotion(false);
    render(<TypewriterText text="Hello" speed={100} />);
    expect(screen.queryByText('Hello')).toBeNull();
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByText('He')).toBeInstanceOf(HTMLElement);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Hello')).toBeInstanceOf(HTMLElement);
  });

  it('shows the full text at once and completes under prefers-reduced-motion', () => {
    setReducedMotion(true);
    const onComplete = vi.fn();
    render(<TypewriterText text="Hello" speed={100} onComplete={onComplete} />);
    expect(screen.getByText('Hello')).toBeInstanceOf(HTMLElement);
    expect(onComplete).toHaveBeenCalled();
  });

  it('edge: empty text under reduced motion renders no cursor', () => {
    setReducedMotion(true);
    const { container } = render(<TypewriterText text="" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

describe('AnimatedReveal', () => {
  it('control: starts hidden until triggered when motion is allowed', () => {
    setReducedMotion(false);
    render(<AnimatedReveal trigger="manual" animation="fade-up">Section</AnimatedReveal>);
    expect((screen.getByText('Section') as HTMLElement).style.opacity).toBe('0');
  });

  it('shows its final state at once under prefers-reduced-motion', () => {
    setReducedMotion(true);
    render(<AnimatedReveal trigger="manual" animation="fade-up">Section</AnimatedReveal>);
    const el = screen.getByText('Section') as HTMLElement;
    expect(el.style.opacity).toBe('1');
    expect(el.style.transitionDuration).toBe('0ms');
  });
});

describe('AnimatedReveal revealEvent', () => {
  type Fired = string[];
  function Spy({ fired }: { fired: Fired }) {
    const bus = useEventBus();
    React.useEffect(() => bus.on('UI:SECTION_SEEN', () => { fired.push('UI:SECTION_SEEN'); }), [bus, fired]);
    return null;
  }
  function stubObserver(intersecting: boolean) {
    vi.stubGlobal('IntersectionObserver', class {
      private cb: (entries: ObservedEntry[]) => void;
      constructor(cb: (entries: ObservedEntry[]) => void) { this.cb = cb; }
      observe() { this.cb([observed(intersecting)]); }
      disconnect() { /* nothing to release */ }
    });
  }

  it('emits its revealEvent once when the section scrolls into view', () => {
    setReducedMotion(false);
    stubObserver(true);
    const fired: Fired = [];
    render(<EventBusProvider debug={false}><Spy fired={fired} /><AnimatedReveal revealEvent="SECTION_SEEN">Demo</AnimatedReveal></EventBusProvider>);
    expect(fired).toEqual(['UI:SECTION_SEEN']);
  });

  it('emits when the revealEvent arrives after the section was already revealed', () => {
    setReducedMotion(false);
    stubObserver(true);
    const fired: Fired = [];
    const { rerender } = render(<EventBusProvider debug={false}><Spy fired={fired} /><AnimatedReveal revealEvent="">Demo</AnimatedReveal></EventBusProvider>);
    expect(fired).toEqual([]);
    rerender(<EventBusProvider debug={false}><Spy fired={fired} /><AnimatedReveal revealEvent="SECTION_SEEN">Demo</AnimatedReveal></EventBusProvider>);
    expect(fired).toEqual(['UI:SECTION_SEEN']);
  });

  it('control: emits nothing while the section is out of view', () => {
    setReducedMotion(false);
    stubObserver(false);
    const fired: Fired = [];
    render(<EventBusProvider debug={false}><Spy fired={fired} /><AnimatedReveal revealEvent="SECTION_SEEN">Demo</AnimatedReveal></EventBusProvider>);
    expect(fired).toEqual([]);
  });

  it('never emits under prefers-reduced-motion, so nothing starts on its own', () => {
    setReducedMotion(true);
    stubObserver(true);
    const fired: Fired = [];
    render(<EventBusProvider debug={false}><Spy fired={fired} /><AnimatedReveal revealEvent="SECTION_SEEN">Demo</AnimatedReveal></EventBusProvider>);
    expect(fired).toEqual([]);
  });
});

describe('AnimatedReveal enterEvent / leaveEvent', () => {
  type Fired = string[];
  function Spy({ fired }: { fired: Fired }) {
    const bus = useEventBus();
    React.useEffect(() => {
      const offIn = bus.on('UI:IN_VIEW', () => { fired.push('in'); });
      const offOut = bus.on('UI:OUT_OF_VIEW', () => { fired.push('out'); });
      return () => { offIn(); offOut(); };
    }, [bus, fired]);
    return null;
  }
  let drive: (intersecting: boolean) => void = () => undefined;
  function stubDrivenObserver() {
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: (entries: ObservedEntry[]) => void, options?: IntersectionObserverInit) {
        // The reveal observer; the off-screen marker is the one watching with a margin.
        if (options?.rootMargin === undefined) drive = (i) => cb([observed(i)]);
      }
      observe() { /* driven by the test */ }
      disconnect() { /* nothing to release */ }
    });
  }
  const tree = (fired: Fired) => (
    <EventBusProvider debug={false}><Spy fired={fired} /><AnimatedReveal enterEvent="IN_VIEW" leaveEvent="OUT_OF_VIEW">Demo</AnimatedReveal></EventBusProvider>
  );

  it('emits enterEvent on every entry and leaveEvent on every exit after one', () => {
    setReducedMotion(false);
    stubDrivenObserver();
    const fired: Fired = [];
    render(tree(fired));
    act(() => { drive(true); drive(false); drive(true); drive(false); });
    expect(fired).toEqual(['in', 'out', 'in', 'out']);
  });

  it('control: leaving before ever entering emits nothing', () => {
    setReducedMotion(false);
    stubDrivenObserver();
    const fired: Fired = [];
    render(tree(fired));
    act(() => { drive(false); });
    expect(fired).toEqual([]);
  });

  it('still reports visibility under prefers-reduced-motion (it starts nothing by itself)', () => {
    setReducedMotion(true);
    stubDrivenObserver();
    const fired: Fired = [];
    render(tree(fired));
    act(() => { drive(true); drive(false); });
    expect(fired).toEqual(['in', 'out']);
  });
});
