/**
 * A one-column DataGrid is a list: it renders as one surface of divided rows,
 * not a stack of separately-chromed cards. Multi-column, auto-fit, scrollX and
 * custom-render grids keep per-item cards.
 */
import React from 'react';
import { beforeAll, describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DataGrid, type DataGridField } from '../DataGrid';
import { EventBusProvider, NavStackProvider, useEventBus } from '../../../../core';
import { loadTestKernel } from '../../../../test-support/kernel-engine';

const renderWithProvider = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

const fields: readonly DataGridField[] = [
  { name: 'name', variant: 'h3' },
  { name: 'role', variant: 'badge' },
  { name: 'email', label: 'Email', variant: 'body' },
];

const rows = [
  { id: '1', name: 'Heath Keystone', role: 'customer', email: 'h@x.io', photo: 'https://img.test/h.png' },
  { id: '2', name: 'Brook Isle', role: 'store-manager', email: 'b@x.io', photo: '' },
];

const layoutOf = (container: HTMLElement) => container.querySelector('[data-grid-layout]')?.getAttribute('data-grid-layout');
const rowOf = (name: string) => screen.getByText(name).closest('[data-entity-row]') as HTMLElement;

describe('DataGrid single-column rows', () => {
  beforeAll(async () => { await loadTestKernel(); });

  it('navigates to an authored row route without emitting its action event', () => {
    const fired: string[] = [];
    function Spy() {
      const bus = useEventBus();
      React.useEffect(() => bus.on('UI:VIEW', () => { fired.push('event'); }), [bus]);
      return null;
    }
    render(
      <EventBusProvider>
        <Spy />
        <NavStackProvider pages={[]} currentPath="/" navigate={(url) => { fired.push(url); }}>
          <DataGrid entity={[rows[0]]} fields={fields} cols={1} itemActions={[{
            label: 'Open', event: 'VIEW', navigatesTo: ['fn', 'row', ['str/concat', '/contacts/', '@row.id']], variant: 'primary',
          }]} />
        </NavStackProvider>
      </EventBusProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Open/ }));
    expect(fired).toEqual(['/contacts/1']);
  });
  it('cols=1 renders one divided surface; rows carry no card chrome', () => {
    const { container } = renderWithProvider(<DataGrid entity={rows} fields={fields} cols={1} />);
    expect(layoutOf(container)).toBe('rows');
    for (const name of ['Heath Keystone', 'Brook Isle']) {
      const row = rowOf(name);
      expect(row.className).not.toMatch(/\bborder\b/);
      expect(row.className).not.toMatch(/shadow-elevation/);
    }
  });

  it('cols=1 caps the title at h4 — a row is not a hero', () => {
    renderWithProvider(<DataGrid entity={rows} fields={fields} cols={1} />);
    expect(screen.getByText('Heath Keystone').tagName).toBe('H4');
  });

  it('control: cols=2 keeps per-item cards and the declared h3 title', () => {
    const { container } = renderWithProvider(<DataGrid entity={rows} fields={fields} cols={2} />);
    expect(layoutOf(container)).toBe('cards');
    expect(rowOf('Heath Keystone').className).toMatch(/\bborder\b/);
    expect(screen.getByText('Heath Keystone').tagName).toBe('H3');
  });

  it('control: auto-fit (no cols) keeps cards', () => {
    const { container } = renderWithProvider(<DataGrid entity={rows} fields={fields} />);
    expect(layoutOf(container)).toBe('cards');
  });

  it('edge: scrollX with cols=1 stays a card board', () => {
    const { container } = renderWithProvider(<DataGrid entity={rows} fields={fields} cols={1} scrollX />);
    expect(layoutOf(container)).toBe('cards');
  });

  it('edge: a custom renderItem owns its chrome, so cols=1 leaves it alone', () => {
    const { container } = renderWithProvider(
      <DataGrid entity={rows} cols={1} renderItem={(item) => <span>{String(item.name)}</span>} />,
    );
    expect(layoutOf(container)).toBe('cards');
  });

  it('edge: imageField in rows mode renders a leading thumbnail, and rows without an image render none', () => {
    renderWithProvider(<DataGrid entity={rows} fields={fields} cols={1} imageField="photo" />);
    const img = rowOf('Heath Keystone').querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://img.test/h.png');
    expect(img?.parentElement?.className).not.toMatch(/aspect-video/);
    expect(img?.parentElement?.className).toMatch(/w-12/);
    expect(rowOf('Brook Isle').querySelector('img')).toBeNull();
  });

  it('edge: row actions still render in rows mode', () => {
    renderWithProvider(
      <DataGrid entity={rows} fields={fields} cols={1} itemActions={[{ label: 'Edit', event: 'EDIT', variant: 'primary' }]} />,
    );
    expect(screen.getAllByTestId('action-EDIT')).toHaveLength(2);
  });
});
