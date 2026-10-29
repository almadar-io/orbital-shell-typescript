/**
 * TableView Component Tests — relation-column rendering.
 *
 * `relation-field-rendered-raw`: a column whose entity field is relation-typed
 * must render the related row's label, not the raw foreign id. Pins both the
 * "no relationsData" (id shows, historical behavior for a column with nothing
 * to resolve against) and "relationsData present" (label shows) cases so the
 * fix can't silently regress either way.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TableView, type TableViewColumn } from '../TableView';
import { EventBusProvider } from '../../../../core';

const renderWithProvider = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

const columns: readonly TableViewColumn[] = [
  { key: 'title', header: 'Applicant' },
  { key: 'interviewerName', field: 'interviewerName', header: 'Interviewer' },
];

const rows = [
  { id: '1', title: 'Jane Doe', interviewerName: 'staff-42' },
];

describe('TableView relation columns', () => {
  it('renders the raw foreign id when no relationsData is supplied', () => {
    renderWithProvider(<TableView entity={rows} columns={columns} />);
    expect(screen.getByText('staff-42')).toBeInTheDocument();
  });

  it('renders the related row label when relationsData resolves the column', () => {
    renderWithProvider(
      <TableView
        entity={rows}
        columns={columns}
        relationsData={{ interviewerName: [{ value: 'staff-42', label: 'Sam Staff' }] }}
      />,
    );
    expect(screen.getByText('Sam Staff')).toBeInTheDocument();
    expect(screen.queryByText('staff-42')).not.toBeInTheDocument();
  });

  it('renders a hydrated relation row by its id when no relationsData declares its label', () => {
    renderWithProvider(
      <TableView
        entity={[{ id: '1', title: 'Jane Doe', interviewerName: { id: 'staff-42', name: 'Sam Staff' } }]}
        columns={columns}
      />,
    );
    expect(screen.getByText('staff-42')).toBeInTheDocument();
    expect(screen.queryByText('Sam Staff')).toBeNull();
  });

  it('resolves the label inside a badge-format relation column too', () => {
    const badgeColumns: readonly TableViewColumn[] = [
      { key: 'interviewerName', field: 'interviewerName', header: 'Interviewer', format: 'badge' },
    ];
    renderWithProvider(
      <TableView
        entity={rows}
        columns={badgeColumns}
        relationsData={{ interviewerName: [{ value: 'staff-42', label: 'Sam Staff' }] }}
      />,
    );
    expect(screen.getByText('Sam Staff')).toBeInTheDocument();
    expect(screen.queryByText('staff-42')).not.toBeInTheDocument();
  });
});

describe('TableView narrow (stacked) layout — G-CROSS-019', () => {
  const cols: readonly TableViewColumn[] = [
    { key: 'path', header: 'Path', variant: 'h4' },
    { key: 'method', header: 'Method', format: 'badge' },
    { key: 'owner', header: 'Owner' },
  ];
  const data = [{ id: 'r1', path: '/orders', method: 'GET', owner: 'Isle Zenith' }];

  it('is its own size container, so rows respond to the table width, not the viewport', () => {
    const { container } = renderWithProvider(<TableView entity={data} columns={cols} />);
    expect(container.querySelector('[role="table"]')?.className).toContain('@container/table');
  });

  it('labels every non-title cell with its column for the stacked view', () => {
    renderWithProvider(<TableView entity={data} columns={cols} />);
    const cells = screen.getAllByRole('cell');
    const labels = cells.map((c) => c.querySelector('[data-stacked-label]')?.textContent ?? null);
    expect(labels).toEqual([null, 'Method', 'Owner']);
  });

  it('control: the column header row still carries every label for the wide view', () => {
    renderWithProvider(<TableView entity={data} columns={cols} />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Path', 'Method', 'Owner']);
  });

  it('edge: a single-column table has no stacked labels at all', () => {
    renderWithProvider(<TableView entity={data} columns={[cols[0]]} />);
    expect(document.querySelectorAll('[data-stacked-label]')).toHaveLength(0);
  });

  it('edge: a render-prop row keeps its own layout and gets no stacked labels', () => {
    renderWithProvider(<TableView entity={data} columns={cols}>{(row) => <span>{String(row.path)}</span>}</TableView>);
    expect(document.querySelectorAll('[data-stacked-label]')).toHaveLength(0);
    expect(screen.getByText('/orders')).toBeTruthy();
  });
});

describe('TableView ARIA table structure', () => {
  const rowgroupsHoldRows = (container: HTMLElement) =>
    [...container.querySelectorAll('[role="rowgroup"]')].every((group) =>
      group.children.length > 0 && [...group.children].every((child) => child.getAttribute('role') === 'row' && child.querySelector('[role="cell"],[role="columnheader"]') !== null));

  it('an empty, loading or failed table keeps its status inside a row and cell', () => {
    for (const ui of [
      <TableView entity={[]} columns={columns} />,
      <TableView entity={[]} columns={columns} isLoading />,
      <TableView entity={[]} columns={columns} error={new Error('boom')} />,
    ]) {
      const { container, unmount } = renderWithProvider(ui);
      expect(rowgroupsHoldRows(container)).toBe(true);
      unmount();
    }
  });

  it('control: a populated table already holds rows of cells', () => {
    const { container } = renderWithProvider(<TableView entity={rows} columns={columns} />);
    expect(rowgroupsHoldRows(container)).toBe(true);
  });
});
