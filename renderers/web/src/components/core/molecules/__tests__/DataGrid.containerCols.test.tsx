/**
 * A grid's columns follow its own width, not the browser viewport: a board laid
 * out in a 950px area shows its four columns on any screen, and inside a
 * desktop-size demo scaled into a narrow page it keeps the desktop layout.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { EntityRow } from '@almadar/core';
import { DataGrid } from '../DataGrid';
import { EventBusProvider } from '../../../../core';

const rows: EntityRow[] = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
const grid = (cols: 2 | 3 | 4) => render(
  <EventBusProvider debug={false}>
    <DataGrid entity={rows} cols={cols} renderItem={(item) => <span>{String(item.title)}</span>} />
  </EventBusProvider>,
);

describe('DataGrid columns follow the grid width', () => {
  it('four columns come from container breakpoints only', () => {
    const html = grid(4).container.innerHTML;
    expect(html).toContain('@[56rem]:grid-cols-4');
    expect(html).toContain('@[42rem]:grid-cols-3');
    expect(html).toContain('@[30rem]:grid-cols-2');
    expect(html).not.toMatch(/(^|\s)(sm|lg|xl):grid-cols-/);
  });

  it('the grid is its own container', () => {
    expect(grid(3).container.querySelector('.\\@container')).not.toBeNull();
  });
});
