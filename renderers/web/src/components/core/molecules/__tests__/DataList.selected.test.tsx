import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DataList } from '../DataList';
import { EventBusProvider } from '../../../../core';

const rows = [{ id: 'a', title: 'Deals pipeline' }, { id: 'b', title: 'Company books' }];
const fields = [{ name: 'title', variant: 'body' as const }];
const selected = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[data-entity-row][aria-current="true"]')].map((r) => r.getAttribute('data-entity-id') ?? '');

describe('DataList selectedId', () => {
  it('marks the row whose id is selectedId as the current one, and only that row', () => {
    const { container } = render(<EventBusProvider debug={false}><DataList entity={rows} fields={fields} selectedId="b" /></EventBusProvider>);
    expect(selected(container)).toEqual(['b']);
    expect(container.querySelector('[data-entity-id="b"]')?.hasAttribute('data-selected')).toBe(true);
    expect(container.querySelector('[data-entity-id="a"]')?.hasAttribute('data-selected')).toBe(false);
  });

  it('marks the selected row of a list drawn by renderItem too', () => {
    const { container } = render(
      <EventBusProvider debug={false}>
        <DataList entity={rows} selectedId="a" renderItem={(row) => <span>{String(row.title)}</span>} />
      </EventBusProvider>,
    );
    expect(selected(container)).toEqual(['a']);
  });

  it('control: no row is current without selectedId, or when no row has that id', () => {
    const none = render(<EventBusProvider debug={false}><DataList entity={rows} fields={fields} /></EventBusProvider>);
    expect(selected(none.container)).toEqual([]);
    const other = render(<EventBusProvider debug={false}><DataList entity={rows} fields={fields} selectedId="zz" /></EventBusProvider>);
    expect(selected(other.container)).toEqual([]);
  });
});
