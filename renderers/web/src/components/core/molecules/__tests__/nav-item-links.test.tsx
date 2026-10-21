/**
 * Sidebar and Navigation items that declare an `href` are real links, so a
 * crawler (and a middle-click) can follow them; an item's `onClick` still runs.
 * Items without an `href` stay buttons.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { Navigation } from '../Navigation';
import { NavStackProvider } from '../../../../core';
import { EventBusProvider } from '../../../../core';

function mount(ui: React.ReactElement, navigate = vi.fn()) {
  render(
    <EventBusProvider debug={false}>
      <NavStackProvider pages={[]} currentPath="/" navigate={navigate}>
        {ui}
      </NavStackProvider>
    </EventBusProvider>,
  );
  return navigate;
}

describe('nav items with an href', () => {
  it('a sidebar item with an href is a link that navigates in-app', () => {
    const navigate = mount(<Sidebar items={[{ id: 'docs', label: 'Docs', href: '/docs' }]} />);
    const link = screen.getByRole('link', { name: /docs/i });
    expect(link.getAttribute('href')).toBe('/docs');
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/docs');
  });

  it('a navigation item with an href is a link and still runs its onClick', () => {
    const onClick = vi.fn();
    mount(<Navigation items={[{ id: 'docs', label: 'Docs', href: '/docs', onClick }]} />);
    const link = screen.getByRole('link', { name: /docs/i });
    expect(link.getAttribute('href')).toBe('/docs');
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('control: items without an href stay buttons', () => {
    const onClick = vi.fn();
    mount(
      <>
        <Sidebar items={[{ id: 'a', label: 'Alpha', onClick }]} />
        <Navigation items={[{ id: 'b', label: 'Beta', onClick }]} />
      </>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /alpha/i }));
    fireEvent.click(screen.getByRole('button', { name: /beta/i }));
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
