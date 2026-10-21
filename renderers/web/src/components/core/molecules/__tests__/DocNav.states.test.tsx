import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DocSidebar } from '../DocSidebar';
import { DocPagination } from '../DocPagination';
import { DocTOC } from '../DocTOC';
import { NavStackProvider } from '../../../../core';

const withNav = (ui: React.ReactElement) =>
  render(
    <NavStackProvider pages={[]} currentPath="/" navigate={vi.fn()}>
      {ui}
    </NavStackProvider>,
  );

/** The ghost variant's action hover (a solid primary fill) must not survive on a navigation row. */
function expectNavRow(el: HTMLElement): void {
  expect(el.className).not.toMatch(/(^|\s)hover:bg-primary(\s|$)/);
  expect(el.className).not.toMatch(/(^|\s)hover:text-primary-foreground(\s|$)/);
}

describe('DocSidebar row states', () => {
  const items = [
    { label: 'Guide', items: [{ label: 'Intro', href: '/intro', active: true }, { label: 'Setup', href: '/setup' }] },
  ];

  it('the active row is marked with the accent and its hover keeps the accent', () => {
    withNav(<DocSidebar items={items} />);
    const active = screen.getByRole('link', { name: 'Intro' });
    expectNavRow(active);
    expect(active.className).toMatch(/(^|\s)text-accent(\s|$)/);
    expect(active.className).toMatch(/(^|\s)hover:text-accent(\s|$)/);
  });

  it('control: an inactive row hovers to the muted surface with foreground text', () => {
    withNav(<DocSidebar items={items} />);
    const row = screen.getByRole('link', { name: 'Setup' });
    expectNavRow(row);
    expect(row.className).toMatch(/(^|\s)hover:bg-muted(\s|$)/);
    expect(row.className).toMatch(/(^|\s)hover:text-foreground(\s|$)/);
  });

  it('edge: labels inherit the row color, so the row hover color reaches the text', () => {
    withNav(<DocSidebar items={items} />);
    for (const name of ['Intro', 'Setup']) {
      const label = screen.getByText(name);
      expect(label.className).toMatch(/(^|\s)text-inherit(\s|$)/);
      expect(label.className).not.toMatch(/(^|\s)text-(primary|muted-foreground)(\s|$)/);
    }
  });

  it('edge: a category toggle hovers to the muted surface, not the primary fill', () => {
    withNav(<DocSidebar items={items} />);
    const toggle = screen.getByRole('button', { name: /Guide/ });
    expectNavRow(toggle);
    expect(toggle.className).toMatch(/(^|\s)hover:bg-muted(\s|$)/);
  });
});

describe('DocTOC row states', () => {
  const items = [
    { id: 'a', label: 'Alpha', level: 2 },
    { id: 'b', label: 'Beta', level: 2 },
  ];

  it('rows never take the primary fill; the active row is marked with the accent rule', () => {
    withNav(<DocTOC items={items} activeId="a" />);
    const active = screen.getByRole('link', { name: 'Alpha' });
    const other = screen.getByRole('link', { name: 'Beta' });
    expectNavRow(active);
    expectNavRow(other);
    expect(active.className).toMatch(/(^|\s)border-l-accent(\s|$)/);
    expect(screen.getByText('Beta').className).toMatch(/(^|\s)text-inherit(\s|$)/);
  });
});

describe('DocPagination card states', () => {
  it('cards hover to an accent border on their own surface, never a primary fill', () => {
    withNav(<DocPagination prev={{ label: 'Before', href: '/b' }} next={{ label: 'After', href: '/a' }} />);
    for (const name of [/Before/, /After/]) {
      const card = screen.getByRole('link', { name });
      expectNavRow(card);
      expect(card.className).toMatch(/(^|\s)hover:border-accent(\s|$)/);
      expect(card.className).toMatch(/(^|\s)hover:bg-card(\s|$)/);
    }
  });
});
