/**
 * Column floors are `ch`-based, and `ch` resolves against the row's own font
 * size. The header row and body rows must therefore share one font size, or the
 * same track template resolves to different widths and labels drift off their
 * columns. Small caps belong on the label text, not on the header row.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TableView, type TableViewColumn } from '../TableView';
import { EventBusProvider } from '../../../../core';

const renderWithProvider = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

const columns: readonly TableViewColumn[] = [
  { key: 'name', header: 'Task' },
  { key: 'owner', header: 'Owner' },
  { key: 'days', header: 'Days', align: 'right', format: 'number' },
];
const rows = [{ id: '1', name: 'Renew vendor contract', owner: 'Ruth Adeyemi', days: 145 }];
const FONT_SIZE = /(^|\s)(@\S+:)?text-(xs|sm|base|lg|xl|\d?xl)(\s|$)/;

describe('TableView header/body track parity', () => {
  it('the header row carries no font-size of its own', () => {
    renderWithProvider(<TableView entity={rows} columns={columns} />);
    const headerRow = screen.getAllByRole('columnheader')[0].parentElement as HTMLElement;
    expect(headerRow.className).not.toMatch(FONT_SIZE);
  });

  it('control: body rows carry no font-size of their own either', () => {
    renderWithProvider(<TableView entity={rows} columns={columns} />);
    const bodyRow = document.querySelector('[role=row][data-entity-row]') as HTMLElement;
    expect(bodyRow.className).not.toMatch(FONT_SIZE);
  });

  it('the small-caps label styling still reaches every header label', () => {
    renderWithProvider(<TableView entity={rows} columns={columns} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Task', 'Owner', 'Days']);
    for (const h of headers) expect(h.querySelector('.text-xs')).not.toBeNull();
  });
});
