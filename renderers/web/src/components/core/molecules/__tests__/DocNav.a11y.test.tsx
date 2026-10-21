import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocSidebar } from '../DocSidebar';
import { DocPagination } from '../DocPagination';
import { DocTOC } from '../DocTOC';
import { DocBreadcrumb } from '../DocBreadcrumb';
import { NavStackProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const withNav = (ui: React.ReactElement, navigate = vi.fn()) => {
  const out = render(
    <NavStackProvider pages={[]} currentPath="/" navigate={navigate}>
      {ui}
    </NavStackProvider>,
  );
  return { ...out, navigate };
};

describe('DocSidebar a11y', () => {
  const items = [
    {
      label: 'Guide',
      items: [
        { label: 'Intro', href: '/intro', active: true },
        { label: 'Setup', href: '/setup' },
      ],
    },
    { label: 'Plain note' },
    { label: 'API', href: '/api' },
  ];

  it('leaf items are real links, the active one is aria-current=page, axe clean', async () => {
    const { container } = withNav(<DocSidebar items={items} />);
    const intro = screen.getByRole('link', { name: 'Intro' });
    expect(intro.getAttribute('href')).toBe('/intro');
    expect(intro.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Setup' }).hasAttribute('aria-current')).toBe(false);
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('categories are expand buttons that toggle', () => {
    withNav(<DocSidebar items={[{ label: 'Closed', items: [{ label: 'Child', href: '/c' }] }]} />);
    const toggle = screen.getByRole('button', { name: 'Closed' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Child' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Child' })).toBeTruthy();
  });

  it('an item without href is plain text, not a link', () => {
    withNav(<DocSidebar items={items} />);
    expect(screen.queryByRole('link', { name: 'Plain note' })).toBeNull();
    expect(screen.getByText('Plain note')).toBeTruthy();
  });

  it('a link click navigates through the nav stack', () => {
    const { navigate } = withNav(<DocSidebar items={items} />);
    fireEvent.click(screen.getByRole('link', { name: 'API' }));
    expect(navigate).toHaveBeenCalledWith('/api');
  });
});

describe('DocPagination a11y', () => {
  it('prev/next are real links', async () => {
    const { container, navigate } = withNav(
      <DocPagination prev={{ label: 'Back', href: '/back', category: 'Intro' }} next={{ label: 'Onward', href: '/next' }} />,
    );
    expect(screen.getByRole('link', { name: /Back/ }).getAttribute('href')).toBe('/back');
    fireEvent.click(screen.getByRole('link', { name: /Onward/ }));
    expect(navigate).toHaveBeenCalledWith('/next');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('only the provided side renders; none renders nothing', () => {
    const { container } = withNav(<DocPagination next={{ label: 'Only', href: '/o' }} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    const empty = withNav(<DocPagination />);
    expect(empty.container.firstChild?.firstChild ?? null).toBeNull();
    expect(container).toBeTruthy();
  });
});

describe('DocTOC a11y', () => {
  it('entries are anchor links; the active one is aria-current=location; click scrolls', async () => {
    const target = document.createElement('h2');
    target.id = 'two';
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    document.body.appendChild(target);
    const { container } = withNav(
      <DocTOC items={[{ id: 'one', label: 'One', level: 2 }, { id: 'two', label: 'Two', level: 3 }]} activeId="two" />,
    );
    const two = screen.getByRole('link', { name: 'Two' });
    expect(two.getAttribute('href')).toBe('#two');
    expect(two.getAttribute('aria-current')).toBe('location');
    expect(screen.getByRole('link', { name: 'One' }).hasAttribute('aria-current')).toBe(false);
    fireEvent.click(two);
    expect(scroll).toHaveBeenCalled();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
    target.remove();
  });
});

describe('DocBreadcrumb', () => {
  const crumbs = [{ label: 'Docs', href: '/docs' }, { label: 'Core concepts', href: '/docs/core-concepts' }, { label: 'Traits' }];

  it('ancestors are real links that navigate through the nav stack', async () => {
    const { container, navigate } = withNav(<DocBreadcrumb items={crumbs} />);
    const docs = screen.getByRole('link', { name: 'Docs' });
    expect(docs.getAttribute('href')).toBe('/docs');
    fireEvent.click(docs);
    expect(navigate).toHaveBeenCalledWith('/docs');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: the current page is plain text, not a link', () => {
    withNav(<DocBreadcrumb items={crumbs} />);
    expect(screen.queryByRole('link', { name: 'Traits' })).toBeNull();
    expect(screen.getByText('Traits')).toBeTruthy();
  });
});
