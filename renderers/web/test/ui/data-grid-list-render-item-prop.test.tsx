// @vitest-environment jsdom
/**
 * The compiled (orbital-rust) codegen path passes the per-item renderer to
 * `DataGrid`/`DataList` as the `renderItem` PROP (a real function); the
 * interpreted/runtime path passes it as `children` (function-as-children).
 * Both components declared + typed `renderItem` but only ever invoked
 * `children` — so every compiled DataGrid/DataList (every kanban board,
 * gallery, card grid) silently rendered zero items
 * (C-DATAGRID-RENDERITEM-IGNORED / C-DATALIST-RENDERITEM-IGNORED). Pin that
 * a real-function `renderItem` prop renders exactly like `children` would.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { DataGrid } from '../../src/components/core/molecules/DataGrid';
import { DataList } from '../../src/components/core/molecules/DataList';

const ROWS = [
  { id: 'a', title: 'First' },
  { id: 'b', title: 'Second' },
];

describe('DataGrid renderItem prop', () => {
  it('renders each row via a function passed as the renderItem prop', () => {
    render(
      <EventBusProvider>
        <DataGrid
          entity={ROWS}
          renderItem={(item) => <div data-testid="grid-card">{String(item.title)}</div>}
        />
      </EventBusProvider>,
    );
    expect(screen.getAllByTestId('grid-card')).toHaveLength(2);
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
  });
});

describe('DataList renderItem prop', () => {
  it('renders each row via a function passed as the renderItem prop', () => {
    render(
      <EventBusProvider>
        <DataList
          entity={ROWS}
          renderItem={(item) => <div data-testid="list-card">{String(item.title)}</div>}
        />
      </EventBusProvider>,
    );
    expect(screen.getAllByTestId('list-card')).toHaveLength(2);
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
  });
});
