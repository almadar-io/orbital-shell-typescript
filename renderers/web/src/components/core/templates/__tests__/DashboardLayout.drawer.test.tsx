import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardLayout } from '../DashboardLayout';

let observedWidth = 1440;

function rect(width: number): DOMRectReadOnly {
  return { x: 0, y: 0, width, height: 0, top: 0, left: 0, right: width, bottom: 0, toJSON: () => ({}) };
}

class FixedWidthObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    const entry: ResizeObserverEntry = { target, contentRect: rect(observedWidth), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] };
    this.cb([entry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => { vi.stubGlobal('ResizeObserver', FixedWidthObserver); });
afterEach(() => { vi.unstubAllGlobals(); });

function renderLayout(width: number, layoutMode: React.ComponentProps<typeof DashboardLayout>['layoutMode']) {
  observedWidth = width;
  return render(
    <MemoryRouter>
      <DashboardLayout appName="Learn" layoutMode={layoutMode} navItems={[{ label: 'Home', href: '/', icon: 'home' }]}>
        <span>content</span>
      </DashboardLayout>
    </MemoryRouter>,
  );
}

const aside = (): HTMLElement | null => document.querySelector('aside');

describe('DashboardLayout layoutMode drawer', () => {
  it('keeps the navigation closed on a wide screen until the menu button opens it', () => {
    renderLayout(1440, 'drawer');
    expect(aside()?.hasAttribute('inert')).toBe(true);
    const open = screen.getByRole('button', { name: 'Open sidebar' });
    act(() => { fireEvent.click(open); });
    expect(aside()?.hasAttribute('inert')).toBe(false);
  });

  it('closes again from the panel close button', () => {
    renderLayout(1440, 'drawer');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Close panel' })); });
    expect(aside()?.hasAttribute('inert')).toBe(true);
  });

  it('names the app in the top bar, since the sidebar header is hidden', () => {
    renderLayout(1440, 'drawer');
    expect(screen.getByRole('banner').textContent).toContain('Learn');
  });

  it('never collapses to the icon rail at tablet widths', () => {
    renderLayout(900, 'drawer');
    expect(aside()?.className).toMatch(/(^|\s)w-64(\s|$)/);
  });

  it('control: sidebar mode on a wide screen shows the sidebar with no menu button', () => {
    renderLayout(1440, 'sidebar');
    expect(aside()?.hasAttribute('inert')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Open sidebar' })).toBeNull();
  });
});
