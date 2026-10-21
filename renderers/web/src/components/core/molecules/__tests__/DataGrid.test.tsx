/**
 * DataGrid Component Tests — relation-field rendering.
 *
 * `relation-field-rendered-raw`: a field whose entity field is relation-typed
 * must render the related row's label, not the raw foreign id.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataGrid, type DataGridField } from '../DataGrid';
import { EventBusProvider } from '../../../../core';

const renderWithProvider = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

const fields: readonly DataGridField[] = [
  { name: 'title', variant: 'h4' },
  { name: 'assignee', variant: 'body' },
];

const rows = [{ id: '1', title: 'Task One', assignee: 'staff-42' }];

describe('DataGrid relation fields', () => {
  it('renders the raw foreign id when no relationsData is supplied', () => {
    renderWithProvider(<DataGrid entity={rows} fields={fields} />);
    expect(screen.getByText('staff-42')).toBeInTheDocument();
  });

  it('renders the related row label when relationsData resolves the field', () => {
    renderWithProvider(
      <DataGrid
        entity={rows}
        fields={fields}
        relationsData={{ assignee: [{ value: 'staff-42', label: 'Sam Staff' }] }}
      />,
    );
    expect(screen.getByText('Sam Staff')).toBeInTheDocument();
    expect(screen.queryByText('staff-42')).not.toBeInTheDocument();
  });
});
