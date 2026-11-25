/**
 * Every sidebar row has the same box: a group header (a button that opens its children) matches a
 * plain link in height, padding and icon-to-label gap. The header took the button's own minimum
 * height and border, so Project Friday's Work and Time rows stood taller and sat off the others.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardLayout } from '../DashboardLayout';

class StubObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
afterEach(() => { vi.unstubAllGlobals(); });

const BOX = /^(min-h-|h-|p[xytbse]?-|gap-|border(-0)?$)/;

function boxTokens(el: Element): string[] {
  return el.className.split(/\s+/).filter((c) => BOX.test(c)).sort();
}

function mount(): void {
  vi.stubGlobal('ResizeObserver', StubObserver);
  render(
    <MemoryRouter initialEntries={['/tasks']}>
      <DashboardLayout
        appName="Friday"
        navItems={[
          { label: 'Home', href: '/home', icon: 'home' },
          { label: 'Work', href: '/tasks', icon: 'check-square', children: [{ label: 'Tasks', href: '/tasks', icon: 'check-square' }] },
          { label: 'Chat', href: '/chat', icon: 'message-square' },
        ]}
      >
        <span>content</span>
      </DashboardLayout>
    </MemoryRouter>,
  );
}

function nav(): HTMLElement {
  return screen.getAllByRole('navigation').find((n) => n.querySelector('button[aria-expanded]') !== null) as HTMLElement;
}

describe('DashboardLayout sidebar rows', () => {
  it('a group header has the same box as a plain link', () => {
    mount();
    const header = nav().querySelector('button[aria-expanded]') as HTMLElement;
    const link = [...nav().querySelectorAll('a')].find((a) => a.textContent === 'Home') as HTMLElement;
    expect(boxTokens(header)).toEqual([...boxTokens(link), 'border-0', 'min-h-0'].sort());
  });

  it('a group header spaces its icon and label like a plain link', () => {
    mount();
    const header = nav().querySelector('button[aria-expanded]') as HTMLElement;
    const row = header.querySelector('[data-nav-row]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.className).toContain('gap-3');
  });

  it('control: two plain links share one box', () => {
    mount();
    const links = [...nav().querySelectorAll('a')];
    const home = links.find((a) => a.textContent === 'Home') as HTMLElement;
    const chat = links.find((a) => a.textContent === 'Chat') as HTMLElement;
    expect(boxTokens(home)).toEqual(boxTokens(chat));
  });
});
