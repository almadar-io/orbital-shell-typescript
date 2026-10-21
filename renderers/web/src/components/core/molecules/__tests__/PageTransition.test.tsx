// @vitest-environment jsdom
/**
 * PageTransition: the innermost transition owns the animation (a layout's
 * content region claims the preview host), and a page change restarts the
 * animation without remounting children.
 */
import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { PageTransition } from '../PageTransition';

function owners(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-page-transition]')).map((el) => el.getAttribute('data-page-transition') ?? '');
}

describe('PageTransition', () => {
  it('alone: owns the animation', () => {
    const { container } = render(<PageTransition locationKey="/a"><span>page</span></PageTransition>);
    expect(owners(container)).toEqual(['owner']);
    expect(container.querySelector('[data-page-transition]')?.className).toContain('animate-page-in');
  });

  it('nested: the inner (layout content) transition owns it, the outer host is claimed and does not animate', () => {
    const { container } = render(
      <PageTransition locationKey="/a">
        <nav>sidebar</nav>
        <PageTransition locationKey="/a"><span>content</span></PageTransition>
      </PageTransition>,
    );
    expect(owners(container)).toEqual(['claimed', 'owner']);
    const [outer, inner] = Array.from(container.querySelectorAll('[data-page-transition]'));
    expect(outer.className).not.toContain('animate-page-in');
    expect(inner.className).toContain('animate-page-in');
  });

  it('when the inner transition unmounts, the host owns the animation again', () => {
    function Host() {
      const [layout, setLayout] = useState(true);
      return (
        <PageTransition locationKey="/a">
          <span data-testid="drop" onClick={() => setLayout(false)} />
          {layout ? <PageTransition locationKey="/a"><span>content</span></PageTransition> : <span>bare page</span>}
        </PageTransition>
      );
    }
    const { container } = render(<Host />);
    act(() => { fireEvent.click(screen.getByTestId('drop')); });
    expect(owners(container)).toEqual(['owner']);
  });

  it('a page change restarts the animation but keeps child state (no remount)', () => {
    function Counter() {
      const [n, setN] = useState(0);
      return <span data-testid="count" onClick={() => setN(n + 1)}>{n}</span>;
    }
    const { rerender, container } = render(<PageTransition locationKey="/a"><Counter /></PageTransition>);
    act(() => { fireEvent.click(screen.getByTestId('count')); });
    rerender(<PageTransition locationKey="/b"><Counter /></PageTransition>);
    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(container.querySelector('[data-page-transition]')?.className).toContain('animate-page-in');
  });
});
