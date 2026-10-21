/**
 * `groupFormat` declares how a `groupBy` value is bucketed and labelled: with
 * `date`, rows on the same day share one section headed by the formatted day,
 * never by the raw timestamp. Without it, grouping keeps the raw value.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EntityRow } from '@almadar/core';
import { DataList } from '../DataList';
import { EventBusProvider } from '../../../../core';
import { formatDate } from '../../../../core';

const rows = [
  { id: 'a', title: 'Morning flow', startTime: '2026-10-07T07:00:00.000Z' },
  { id: 'b', title: 'Lunch HIIT', startTime: '2026-10-07T12:30:00.000Z' },
  { id: 'c', title: 'Open lab', startTime: '2026-10-09T18:00:00.000Z' },
];
const renderRow = (item: EntityRow) => <span>{String(item.title)}</span>;
const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('DataList groupFormat', () => {
  it('date: same-day rows share one section headed by the formatted day', () => {
    wrap(<DataList entity={rows} groupBy="startTime" groupFormat="date" renderItem={renderRow} />);
    expect(screen.getAllByText(formatDate(rows[0].startTime))).toHaveLength(1);
    expect(screen.getByText(formatDate(rows[2].startTime))).toBeInTheDocument();
    expect(screen.queryByText(rows[0].startTime)).toBeNull();
  });

  it('control: without groupFormat the raw value is the section', () => {
    wrap(<DataList entity={rows} groupBy="startTime" renderItem={renderRow} />);
    expect(screen.getByText(rows[0].startTime)).toBeInTheDocument();
    expect(screen.getByText(rows[1].startTime)).toBeInTheDocument();
  });

  it('edge: a row with no value groups under an empty label without crashing', () => {
    wrap(<DataList entity={[...rows, { id: 'd', title: 'TBD' }]} groupBy="startTime" groupFormat="date" renderItem={renderRow} />);
    expect(screen.getByText('TBD')).toBeInTheDocument();
  });
});
