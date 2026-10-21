import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardLayout } from '../DashboardLayout';

let observedWidth = 390;

function rect(width: number): DOMRectReadOnly {
  return { x: 0, y: 0, width, height: 0, top: 0, left: 0, right: width, bottom: 0, toJSON: () => ({}) };
}

class FixedWidthObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    const entry: ResizeObserverEntry = {
      target,
      contentRect: rect(observedWidth),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    };
    this.cb([entry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => { vi.stubGlobal('ResizeObserver', FixedWidthObserver); });
afterEach(() => { vi.unstubAllGlobals(); });

function renderLayout(width: number, props: Partial<React.ComponentProps<typeof DashboardLayout>> = {}) {
  observedWidth = width;
  return render(
    <MemoryRouter>
      <DashboardLayout appName="Notes" navItems={[{ label: 'Notes', href: '/', icon: 'file-text' }]} {...props}>
        <span>content</span>
      </DashboardLayout>
    </MemoryRouter>,
  );
}

describe('DashboardLayout on a phone-width container', () => {
  it('shows the app title in the top bar', () => {
    renderLayout(390);
    expect(screen.getByRole('banner').textContent).toContain('Notes');
  });

  it('search collapses to a named icon that expands the field', () => {
    const onSearchSubmit = vi.fn();
    renderLayout(390, { onSearchSubmit });
    const toggle = screen.getByRole('button', { name: 'Search' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => { fireEvent.click(toggle); });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const box = screen.getByRole('searchbox');
    expect(box.closest('[data-dashboard-search]')?.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    fireEvent.change(box, { target: { value: 'pasta' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSearchSubmit).toHaveBeenCalledWith('pasta');
  });

  it('control: on a wide container there is no search toggle', () => {
    renderLayout(1280, { showSearch: true });
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
  });

  it('pads the header for the device safe area', () => {
    renderLayout(390);
    expect(screen.getByRole('banner').className).toContain('safe-area-inset-top');
  });

  it('caps page content at the content width', () => {
    renderLayout(1280);
    expect(screen.getByText('content').closest('[data-page-transition]')?.className).toContain('max-w-[1440px]');
  });
});
