import React from 'react';
import { beforeAll, describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataList, type DataListItemAction } from '../DataList';
import { EventBusProvider, NavStackProvider } from '../../../../core';
import { useEventBus } from '../../../../core';
import { loadTestKernel } from '../../../../test-support/kernel-engine';

type Fired = { name: string; payload: Record<string, unknown> };

function Spy({ names, fired }: { names: string[]; fired: Fired[] }) {
  const bus = useEventBus();
  React.useEffect(() => {
    const offs = names.map((name) => bus.on(name, (e) => { fired.push({ name, payload: (e.payload ?? {}) as Record<string, unknown> }); }));
    return () => offs.forEach((off) => off());
  }, [bus, names, fired]);
  return null;
}

const rows = [{ id: 'c42', title: 'Ada Lovelace', company: 'Analytical' }];
const fields = [{ name: 'title', variant: 'h4' as const }];

function renderList(actions: DataListItemAction[], fired: Fired[]) {
  render(
    <EventBusProvider debug={false}>
      <Spy names={['UI:VIEW']} fired={fired} />
      <NavStackProvider pages={[]} currentPath="/" navigate={(url) => { fired.push({ name: 'NAVIGATE', payload: { url } }); }}>
        <DataList entity={rows} fields={fields} itemActions={actions} />
      </NavStackProvider>
    </EventBusProvider>,
  );
}

describe('DataList row action navigatesTo', () => {
  beforeAll(async () => { await loadTestKernel(); });

  it('evaluates the authored row route and does not also emit the event', () => {
    const fired: Fired[] = [];
    renderList([{ label: 'Open', event: 'VIEW', navigatesTo: ['fn', 'row', ['str/concat', '/contacts/', '@row.id']], variant: 'primary' }], fired);
    fireEvent.click(screen.getByRole('button', { name: /Open/ }));
    expect(fired.map((f) => f.name)).toEqual(['NAVIGATE']);
    expect(fired[0].payload.url).toBe('/contacts/c42');
  });

  it('preserves a literal route', () => {
    const fired: Fired[] = [];
    renderList([{ label: 'All', event: 'VIEW', navigatesTo: '/contacts', variant: 'primary' }], fired);
    fireEvent.click(screen.getByRole('button', { name: /All/ }));
    expect(fired.map((f) => f.name)).toEqual(['NAVIGATE']);
    expect(fired[0].payload.url).toBe('/contacts');
  });

  it('does not navigate or emit when the route expression is invalid', () => {
    const fired: Fired[] = [];
    renderList([{ label: 'Go', event: 'VIEW', navigatesTo: ['fn', 'row', true], variant: 'primary' }], fired);
    fireEvent.click(screen.getByRole('button', { name: /Go/ }));
    expect(fired).toEqual([]);
  });

  it('control: an action without navigatesTo still emits its event', () => {
    const fired: Fired[] = [];
    renderList([{ label: 'View', event: 'VIEW', variant: 'primary' }], fired);
    fireEvent.click(screen.getByRole('button', { name: /View/ }));
    expect(fired.map((f) => f.name)).toEqual(['UI:VIEW']);
  });
});
