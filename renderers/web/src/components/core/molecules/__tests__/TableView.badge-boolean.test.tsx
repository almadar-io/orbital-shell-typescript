import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TableView, type TableViewColumn } from '../TableView';
import { EventBusProvider } from '../../../../core';

const renderWithProvider = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

const col = (extra: Partial<TableViewColumn> = {}): readonly TableViewColumn[] => [
  { key: 'name', header: 'Name' },
  { key: 'available', field: 'available', header: 'Available', format: 'badge', ...extra },
];

describe('TableView badge column with a boolean value', () => {
  it('a boolean renders as the translated yes/no word, never the raw true/false', () => {
    renderWithProvider(<TableView entity={[{ id: '1', name: 'A', available: true }, { id: '2', name: 'B', available: false }]} columns={col()} />);
    expect(screen.queryByText('true')).toBeNull();
    expect(screen.queryByText('false')).toBeNull();
    expect(screen.getAllByText(/^(Yes|No)$/)).toHaveLength(2);
  });

  it('a declared label for the value still wins', () => {
    renderWithProvider(<TableView entity={[{ id: '1', name: 'A', available: true }]} columns={col({ labels: { true: 'Open for booking' } })} />);
    expect(screen.getByText('Open for booking')).toBeInTheDocument();
  });

  it('control: the STRING "true" is data, not a boolean, and shows as stored', () => {
    renderWithProvider(<TableView entity={[{ id: '1', name: 'A', available: 'true' }]} columns={col()} />);
    expect(screen.getByText('true')).toBeInTheDocument();
  });
});
