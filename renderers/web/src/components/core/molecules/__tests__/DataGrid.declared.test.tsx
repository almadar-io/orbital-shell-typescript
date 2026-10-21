/**
 * DataGrid renders only what a field declares: badge colour comes from
 * `colorMap`, the title from an h3/h4 variant — never from a value word or
 * from the field's position.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataGrid, type DataGridField } from '../DataGrid';
import { EventBusProvider } from '../../../../core';

const pill = (text: RegExp): string => screen.getByText(text).closest('.rounded-pill')?.className ?? '';

const wrap = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

const rows = [{ id: '1', name: 'Task One', status: 'failed' }];

describe('DataGrid badge colour', () => {
  it('uses the declared colorMap entry', () => {
    const fields: readonly DataGridField[] = [
      { name: 'name', variant: 'h4' },
      { name: 'status', variant: 'badge', colorMap: { failed: 'success' } },
    ];
    wrap(<DataGrid entity={rows} fields={fields} />);
    expect(pill(/failed/i)).toContain('border-success');
  });

  it('control: an unmapped value is neutral, whatever the word', () => {
    const fields: readonly DataGridField[] = [
      { name: 'name', variant: 'h4' },
      { name: 'status', variant: 'badge' },
    ];
    wrap(<DataGrid entity={rows} fields={fields} />);
    const cls = pill(/failed/i);
    expect(cls).not.toContain('border-error');
    expect(cls).not.toContain('border-success');
  });
});

describe('DataGrid title', () => {
  it('renders the declared h4 field as the title', () => {
    wrap(<DataGrid entity={rows} fields={[{ name: 'status' }, { name: 'name', variant: 'h4' }]} />);
    expect(screen.getByRole('heading', { name: 'Task One' })).toBeInTheDocument();
  });

  it('control: no h3/h4 field means no title row, not the first field', () => {
    wrap(<DataGrid entity={rows} fields={[{ name: 'name' }, { name: 'status' }]} />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('Task One')).toBeInTheDocument();
  });
});

describe('DataGrid card body labels', () => {
  const sheet = [{ id: '1', period: 'Week 12', hours: 13, billable: 85 }];

  it('a body field without an icon shows its declared label beside the value', () => {
    const fields: readonly DataGridField[] = [
      { name: 'period', label: 'Period', variant: 'h4' },
      { name: 'hours', label: 'Hours', format: 'number' },
    ];
    wrap(<DataGrid entity={sheet} fields={fields} />);
    const label = screen.getByText('Hours:');
    expect(label.className).not.toContain('sr-only');
    expect(screen.getByText('13')).toBeTruthy();
  });

  it('control: a body field that declares an icon keeps its label screen-reader-only (the icon names it)', () => {
    const fields: readonly DataGridField[] = [
      { name: 'period', label: 'Period', variant: 'h4' },
      { name: 'hours', label: 'Hours', format: 'number', icon: 'clock' },
    ];
    wrap(<DataGrid entity={sheet} fields={fields} />);
    expect(screen.getByText('Hours:').className).toContain('sr-only');
  });
});
