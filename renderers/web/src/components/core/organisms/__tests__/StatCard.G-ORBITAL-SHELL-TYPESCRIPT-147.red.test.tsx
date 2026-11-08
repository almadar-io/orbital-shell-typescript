/**
 * RED BY DESIGN (H1, G-ORBITAL-SHELL-TYPESCRIPT-147): a metric's value is the program's answer, so the host does not
 * count, sum or filter rows. `it.fails` passes while StatCard still aggregates.
 */
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

describe('G-ORBITAL-SHELL-TYPESCRIPT-147 red: StatCard does not aggregate rows', () => {
  it.fails('paints no count computed from the rows it was handed', () => {
    render(
      <EventBusProvider debug={false}>
        <StatCard entity={rows} metrics={[{ label: 'Tickets', aggregate: 'count' }]} />
      </EventBusProvider>,
    );
    expect(screen.queryByText('3')).toBeNull();
  });

  it.fails('paints no filtered sum computed from the rows it was handed', () => {
    render(
      <EventBusProvider debug={false}>
        <StatCard
          entity={rows}
          metrics={[{ label: 'Total', field: 'amount', aggregate: 'sum', filter: { field: 'status', equals: 'active' } }]}
        />
      </EventBusProvider>,
    );
    expect(screen.queryByText('15')).toBeNull();
  });
});
