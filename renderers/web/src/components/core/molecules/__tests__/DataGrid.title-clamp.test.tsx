/**
 * Almadar_UX 2.7: a card's title wraps up to two lines rather than cutting off on
 * one — a card shares its title row with the primary action, so one line leaves
 * "Intro to Pyt…". A one-column rows list keeps its one-line scanning label.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataGrid, type DataGridField } from '../DataGrid';
import { EventBusProvider } from '../../../../core';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);
const fields: readonly DataGridField[] = [{ name: 'title', variant: 'h4' }];
const rows = [{ id: 'c1', title: 'Introduction to Python for Absolute Beginners' }];

describe('DataGrid card title length', () => {
  it('a card title clamps to two lines instead of truncating to one', () => {
    wrap(<DataGrid entity={rows} fields={fields} cols={3} />);
    const title = screen.getByText(rows[0].title);
    expect(title.className).toContain('line-clamp-2');
    expect(title.className).not.toContain('truncate');
  });

  it('control: a one-column rows list keeps the one-line label', () => {
    wrap(<DataGrid entity={rows} fields={fields} cols={1} />);
    expect(screen.getByText(rows[0].title).className).toContain('truncate');
  });
});
