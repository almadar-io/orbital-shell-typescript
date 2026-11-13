import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

describe('DataList scrollToSelected', () => {
  const calls: string[] = [];
  const original = Element.prototype.scrollIntoView;
  beforeEach(() => {
    calls.length = 0;
    Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
      calls.push(`${this.getAttribute('data-entity-id')}:${typeof arg === 'object' ? arg.block : ''}`);
    };
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });
  const list = (props: { selectedId?: string; scrollToSelected?: boolean; variant?: 'message' }) => (
    <EventBusProvider debug={false}><DataList entity={rows} fields={fields} {...props} /></EventBusProvider>
  );

  it('scrolls the selected row into view (nearest) and again when selectedId changes', () => {
    const { rerender } = render(list({ selectedId: 'b', scrollToSelected: true }));
    expect(calls).toEqual(['b:nearest']);
    rerender(list({ selectedId: 'a', scrollToSelected: true }));
    expect(calls).toEqual(['b:nearest', 'a:nearest']);
  });

  it('scrolls the selected message in the message variant, and marks it', () => {
    const { container } = render(list({ selectedId: 'a', scrollToSelected: true, variant: 'message' }));
    expect(calls).toEqual(['a:nearest']);
    expect(selected(container)).toEqual(['a']);
  });

  it('control: never scrolls without the prop', () => {
    const { rerender } = render(list({ selectedId: 'b' }));
    rerender(list({ selectedId: 'a' }));
    expect(calls).toEqual([]);
  });

  it('control: a selectedId naming no row does nothing', () => {
    render(list({ selectedId: 'zz', scrollToSelected: true }));
    expect(calls).toEqual([]);
  });
});
