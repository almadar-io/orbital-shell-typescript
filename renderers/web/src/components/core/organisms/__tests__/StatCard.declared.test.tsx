import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from '../StatCard';
import { EventBusProvider } from '../../../../core';

const rows = [
  { id: '1', status: 'active', amount: 10 },
  { id: '2', status: 'active', amount: 5 },
  { id: '3', status: 'closed', amount: 7 },
];
const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('StatCard declared metrics', () => {
  it('aggregate count counts the rows', () => {
    wrap(<StatCard entity={rows} metrics={[{ label: 'Tickets', aggregate: 'count' }]} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('a filter narrows the rows before aggregating', () => {
    wrap(<StatCard entity={rows} metrics={[{ label: 'Active', aggregate: 'count', filter: { field: 'status', equals: 'active' } }]} />);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('aggregate sum totals a numeric field', () => {
    wrap(<StatCard entity={rows} metrics={[{ label: 'Total', field: 'amount', aggregate: 'sum', filter: { field: 'status', equals: 'active' } }]} />);
    expect(screen.getByText('15')).toBeTruthy();
  });

  it('control: the old magic field "count" means nothing special', () => {
    wrap(<StatCard entity={rows} metrics={[{ label: 'Tickets', field: 'count' }]} />);
    expect(screen.queryByText('3')).toBeNull();
  });

  it('control: a status value used as a field name is not counted', () => {
    wrap(<StatCard entity={rows} metrics={[{ label: 'Active', field: 'active' }]} />);
    expect(screen.queryByText('2')).toBeNull();
  });

  it('control: the "field:value" string syntax is not parsed', () => {
    wrap(<StatCard entity={rows} metrics={[{ label: 'Active', field: 'status:active' }]} />);
    expect(screen.queryByText('2')).toBeNull();
  });
});
