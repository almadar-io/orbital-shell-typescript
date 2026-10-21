import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AnimatedCounter } from '../AnimatedCounter';

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

let observers: IOCallback[] = [];

function mockMotion(reduced: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function mockIntersectionObserver(): void {
  observers = [];
  class FakeIO {
    constructor(cb: IOCallback) {
      observers.push(cb);
    }
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  }
  vi.stubGlobal('IntersectionObserver', FakeIO);
}

function scrollIntoView(): void {
  act(() => {
    observers.forEach((cb) => cb([{ isIntersecting: true }]));
  });
}

describe('AnimatedCounter', () => {
  beforeEach(() => {
    mockMotion(true);
    mockIntersectionObserver();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the zero state with prefix/suffix before it scrolls into view', () => {
    render(<AnimatedCounter value={1234} prefix="$" suffix="+" format="number" />);
    expect(screen.getByText('$0+')).toBeInTheDocument();
  });

  it('applies number format with prefix and suffix once visible', () => {
    render(<AnimatedCounter value={1234} prefix="$" suffix="+" format="number" />);
    scrollIntoView();
    expect(screen.getByText('$1,234+')).toBeInTheDocument();
  });

  it('keeps embedded affixes and decimals of a string value', () => {
    render(<AnimatedCounter value="99.9%" />);
    scrollIntoView();
    expect(screen.getByText('99.9%')).toBeInTheDocument();
  });

  it('formats currency and percent', () => {
    render(
      <>
        <AnimatedCounter value={12.5} format="currency" />
        <AnimatedCounter value={41.6} format="percent" />
      </>,
    );
    scrollIntoView();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('renders a non-numeric value verbatim', () => {
    render(<AnimatedCounter value="N/A" />);
    scrollIntoView();
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });

  it('renders the label only when given', () => {
    const { rerender } = render(<AnimatedCounter value={3} label="Countries" />);
    expect(screen.getByText('Countries')).toBeInTheDocument();
    rerender(<AnimatedCounter value={3} />);
    expect(screen.queryByText('Countries')).not.toBeInTheDocument();
  });

  it('follows a later value change after the first reveal', () => {
    const { rerender } = render(<AnimatedCounter value={10} />);
    scrollIntoView();
    expect(screen.getByText('10')).toBeInTheDocument();
    rerender(<AnimatedCounter value={25} />);
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('shows the final value without IntersectionObserver (SSR-like env)', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<AnimatedCounter value={7} suffix="x" />);
    expect(screen.getByText('7x')).toBeInTheDocument();
  });
});
