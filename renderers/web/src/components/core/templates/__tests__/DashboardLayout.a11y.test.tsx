import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { DashboardLayout } from '../DashboardLayout';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

let observedWidth = 1280;

function rect(width: number): DOMRectReadOnly {
  return { x: 0, y: 0, width, height: 0, top: 0, left: 0, right: width, bottom: 0, toJSON: () => ({}) };
}

class FixedWidthObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.cb([{ target, contentRect: rect(observedWidth), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => { vi.stubGlobal('ResizeObserver', FixedWidthObserver); });
afterEach(() => { vi.unstubAllGlobals(); });

const navItems = [
  { label: 'Manifesto', href: '/', icon: 'book-open' },
  { label: 'About', href: '/about', icon: 'info' },
];

function renderLayout(width: number, props: Partial<React.ComponentProps<typeof DashboardLayout>> = {}, path = '/') {
  observedWidth = width;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DashboardLayout appName="Reader" navItems={navItems} {...props}>
        <span>content</span>
      </DashboardLayout>
    </MemoryRouter>,
  );
}

describe('DashboardLayout accessibility', () => {
  it('a skip link leads to the main landmark', () => {
    renderLayout(1280);
    const skip = screen.getByRole('link', { name: /skip to content/i });
    const main = screen.getByRole('main');
    expect(skip.getAttribute('href')).toBe(`#${main.id}`);
    expect(main.id).not.toBe('');
  });

  it('the active sidebar link is aria-current="page"; the others are not', () => {
    renderLayout(1280, {}, '/about');
    const nav = screen.getByRole('navigation', { name: /main/i });
    expect(within(nav).getByRole('link', { name: 'About' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Manifesto' }).hasAttribute('aria-current')).toBe(false);
  });

  it('topnav on a phone shows the app name and a menu button that opens the nav as a dialog', () => {
    renderLayout(390, { layoutMode: 'topnav' }, '/about');
    expect(screen.getByRole('banner').textContent).toContain('Reader');
    const menu = screen.getByRole('button', { name: /open menu/i });
    act(() => { fireEvent.click(menu); });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'About' }).getAttribute('aria-current')).toBe('page');
  });

  it('control: topnav on a wide container shows the nav inline and no menu button', () => {
    renderLayout(1280, { layoutMode: 'topnav' });
    expect(screen.queryByRole('button', { name: /open menu/i })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: /main/i })).getByRole('link', { name: 'About' })).toBeTruthy();
  });

  it('a closed mobile sidebar is inert (its links leave the tab order)', () => {
    renderLayout(390);
    const aside = screen.getByRole('complementary', { hidden: true });
    expect(aside.hasAttribute('inert')).toBe(true);
  });

  it('bottomnav marks the current tab and labels its landmark', () => {
    renderLayout(390, { layoutMode: 'bottomnav' }, '/about');
    const nav = screen.getByRole('navigation', { name: /main/i });
    expect(within(nav).getByRole('link', { name: /about/i }).getAttribute('aria-current')).toBe('page');
  });

  it('edge: no axe violations in sidebar, topnav and bottomnav modes', async () => {
    for (const layoutMode of ['sidebar', 'topnav', 'bottomnav'] as const) {
      const { container, unmount } = renderLayout(1280, { layoutMode });
      expect(describeViolations(await axeViolations(container))).toEqual([]);
      unmount();
    }
  });

  it('a route change moves focus to main so the new page is announced', () => {
    observedWidth = 1280;
    let go: (p: string) => void = () => undefined;
    function Nav() { go = useNavigate(); return null; }
    render(
      <MemoryRouter initialEntries={['/']}>
        <Nav />
        <DashboardLayout appName="Reader" navItems={navItems}><span>content</span></DashboardLayout>
      </MemoryRouter>,
    );
    act(() => { go('/about'); });
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('control: the first render does not steal focus', () => {
    renderLayout(1280);
    expect(document.activeElement).not.toBe(screen.getByRole('main'));
  });
});
