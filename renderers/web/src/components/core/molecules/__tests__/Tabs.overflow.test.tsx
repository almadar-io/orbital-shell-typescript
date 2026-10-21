/**
 * A horizontal tab lane wider than its container scrolls — and says so: edge
 * chevrons (and fades) appear on the side(s) with hidden tabs, a chevron scrolls
 * the lane, and the lane declares `data-scroll-affordance` (G-UI-060: tabs past
 * the edge of a lane with a hidden scrollbar were invisible). jsdom has no
 * layout, so each test sets the lane's scroll geometry.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tabs, type TabItem } from '../Tabs';

const items: TabItem[] = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((label) => ({ id: label.toLowerCase(), label }));

interface Geometry { scrollWidth: number; clientWidth: number; scrollLeft: number }
let geometry: Geometry = { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 };
const scrollBy = vi.fn();

const originals = {
  scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth'),
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
  scrollLeft: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft'),
};

function useGeometry(g: Geometry): void {
  geometry = g;
  const lane = (el: Element): boolean => el.getAttribute('role') === 'tablist';
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return lane(this) ? geometry.scrollWidth : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return lane(this) ? geometry.clientWidth : 0; } });
  Object.defineProperty(Element.prototype, 'scrollLeft', { configurable: true, get() { return lane(this) ? geometry.scrollLeft : 0; }, set() {} });
  Object.defineProperty(Element.prototype, 'scrollBy', { configurable: true, writable: true, value: scrollBy });
}

afterEach(() => {
  for (const [key, desc] of Object.entries(originals)) {
    const proto = key === 'scrollLeft' ? Element.prototype : HTMLElement.prototype;
    if (desc) Object.defineProperty(proto, key, desc);
  }
  scrollBy.mockReset();
});

const lane = () => screen.getByRole('tablist');

describe('Tabs overflow affordance', () => {
  it('at the start of an overflowing lane: a right chevron only, and the lane declares the affordance', () => {
    useGeometry({ scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
    render(<Tabs items={items} />);
    expect(screen.getByTestId('tabs-scroll-end')).toBeTruthy();
    expect(screen.queryByTestId('tabs-scroll-start')).toBeNull();
    expect(lane().getAttribute('data-scroll-affordance')).toBe('true');
  });

  it('the chevron scrolls the lane toward the hidden tabs', () => {
    useGeometry({ scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
    render(<Tabs items={items} />);
    fireEvent.click(screen.getByTestId('tabs-scroll-end'));
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0][0]).toMatchObject({ behavior: 'smooth' });
    expect(scrollBy.mock.calls[0][0].left).toBeGreaterThan(0);
  });

  it('scrolled to the end: a left chevron only', () => {
    useGeometry({ scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
    render(<Tabs items={items} />);
    geometry.scrollLeft = 300;
    act(() => { fireEvent.scroll(lane()); });
    expect(screen.getByTestId('tabs-scroll-start')).toBeTruthy();
    expect(screen.queryByTestId('tabs-scroll-end')).toBeNull();
  });

  it('control: a lane that fits shows no chevrons and declares nothing', () => {
    useGeometry({ scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
    render(<Tabs items={items} />);
    expect(screen.queryByTestId('tabs-scroll-start')).toBeNull();
    expect(screen.queryByTestId('tabs-scroll-end')).toBeNull();
    expect(lane().getAttribute('data-scroll-affordance')).toBeNull();
  });

  it('vertical tabs never get a horizontal affordance', () => {
    useGeometry({ scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
    render(<Tabs items={items} orientation="vertical" />);
    expect(screen.queryByTestId('tabs-scroll-end')).toBeNull();
  });
});
