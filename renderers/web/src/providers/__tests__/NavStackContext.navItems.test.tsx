import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavStackProvider, useNavStack } from '../../core';
import { Breadcrumb } from '../../components/core/molecules/Breadcrumb';

const pages = [
  { path: '/projects', name: 'ProjectsPage', orbital: 'Pm' },
  { path: '/projects/:id', name: 'ProjectDetailPage', orbital: 'Pm' },
];

function Register({ items }: { items: { href: string; label: string }[] }) {
  const { registerNavItems } = useNavStack();
  React.useEffect(() => {
    registerNavItems(items);
  });
  return null;
}

describe('NavStackProvider + declared navItems', () => {
  it('the breadcrumb shows the navItem label for the list page, not its page name', async () => {
    render(
      <NavStackProvider pages={pages} currentPath="/projects/7" navigate={() => undefined}>
        <Register items={[{ href: '/projects', label: 'Projects' }]} />
        <Breadcrumb fromNavStack />
      </NavStackProvider>,
    );
    expect(await screen.findByText('Projects')).toBeTruthy();
    expect(screen.queryByText('ProjectsPage')).toBeNull();
  });

  it('control: re-registering a fresh but equal array every render does not loop', async () => {
    render(
      <NavStackProvider pages={pages} currentPath="/projects/7" navigate={() => undefined}>
        <Register items={[{ href: '/projects', label: 'Projects' }]} />
        <Breadcrumb fromNavStack />
      </NavStackProvider>,
    );
    expect(await screen.findByText('Projects')).toBeTruthy();
  });

  it('control: without registered navItems the page name shows as written', async () => {
    render(
      <NavStackProvider pages={pages} currentPath="/projects/7" navigate={() => undefined}>
        <Breadcrumb fromNavStack />
      </NavStackProvider>,
    );
    expect(await screen.findByText('ProjectsPage')).toBeTruthy();
  });
});
