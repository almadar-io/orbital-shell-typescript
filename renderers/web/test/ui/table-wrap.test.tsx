import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { TableView } from '../../src/components/core/molecules/TableView';

const reason = 'the shop answered a bot check (Attention Required! | Cloudflare) and could not be scanned';
const rows = [{ id: '1', shop: 'https://www.bigbang.si', reason }];

describe('TableView wrap columns', () => {
  it('a wrap column shows its whole text on as many lines as it needs, never cut', () => {
    render(
      <EventBusProvider debug={false}>
        <TableView entity={rows} columns={[{ key: 'shop', header: 'Shop' }, { key: 'reason', header: 'Reason', wrap: true }]} />
      </EventBusProvider>,
    );
    const cell = screen.getByText(reason);
    expect(cell.className).not.toContain('truncate');
    expect(cell.className).toContain('whitespace-normal');
    expect(cell.className).toContain('break-words');
  });

  it('control: a column without wrap keeps the one-line truncated cell', () => {
    render(
      <EventBusProvider debug={false}>
        <TableView entity={rows} columns={[{ key: 'shop', header: 'Shop' }, { key: 'reason', header: 'Reason' }]} />
      </EventBusProvider>,
    );
    expect(screen.getByText(reason).className).toContain('truncate');
  });
});
