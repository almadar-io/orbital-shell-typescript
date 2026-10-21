import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataGrid, type DataGridField } from '../DataGrid';
import { EventBusProvider } from '../../../../core';

const renderWithProvider = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

describe('DataGrid progress fields', () => {
  it('renders a progress field as a progress bar with its label', () => {
    const fields: readonly DataGridField[] = [{ name: 'title', variant: 'h3' }, { name: 'progress', label: 'Learned', variant: 'progress' }];
    renderWithProvider(<DataGrid entity={[{ id: '1', title: 'Statistics', progress: 40 }]} fields={fields} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(screen.getByText('Learned')).toBeInTheDocument();
    expect(screen.queryByText('40')).not.toBeInTheDocument();
  });

  it('a non-numeric progress value renders no bar', () => {
    const fields: readonly DataGridField[] = [{ name: 'title', variant: 'h3' }, { name: 'progress', variant: 'progress' }];
    renderWithProvider(<DataGrid entity={[{ id: '1', title: 'Statistics', progress: 'n/a' }]} fields={fields} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('control: a body field still renders as label and value', () => {
    const fields: readonly DataGridField[] = [{ name: 'title', variant: 'h3' }, { name: 'concepts', label: 'Concepts', variant: 'body' }];
    renderWithProvider(<DataGrid entity={[{ id: '1', title: 'Statistics', concepts: 12 }]} fields={fields} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
