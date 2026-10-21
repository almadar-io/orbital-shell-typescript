import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataList, type DataListItemAction } from '../DataList';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

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
      <Spy names={['UI:NAVIGATE', 'UI:VIEW']} fired={fired} />
      <DataList entity={rows} fields={fields} itemActions={actions} />
    </EventBusProvider>,
  );
}

describe('DataList row action navigatesTo', () => {
  it('navigates to the interpolated row url and does not also emit the event', () => {
    const fired: Fired[] = [];
    renderList([{ label: 'Open', event: 'VIEW', navigatesTo: '/contacts/{{row.id}}', variant: 'primary' }], fired);
    fireEvent.click(screen.getByRole('button', { name: /Open/ }));
    expect(fired.map((f) => f.name)).toEqual(['UI:NAVIGATE']);
    expect(fired[0].payload.url).toBe('/contacts/c42');
  });

  it('leaves a url without placeholders unchanged', () => {
    const fired: Fired[] = [];
    renderList([{ label: 'All', event: 'VIEW', navigatesTo: '/contacts', variant: 'primary' }], fired);
    fireEvent.click(screen.getByRole('button', { name: /All/ }));
    expect(fired[0].payload.url).toBe('/contacts');
  });

  it('renders an unknown field as empty', () => {
    const fired: Fired[] = [];
    renderList([{ label: 'Go', event: 'VIEW', navigatesTo: '/x/{{row.missing}}', variant: 'primary' }], fired);
    fireEvent.click(screen.getByRole('button', { name: /Go/ }));
    expect(fired[0].payload.url).toBe('/x/');
  });

  it('control: an action without navigatesTo still emits its event', () => {
    const fired: Fired[] = [];
    renderList([{ label: 'View', event: 'VIEW', variant: 'primary' }], fired);
    fireEvent.click(screen.getByRole('button', { name: /View/ }));
    expect(fired.map((f) => f.name)).toEqual(['UI:VIEW']);
  });
});
