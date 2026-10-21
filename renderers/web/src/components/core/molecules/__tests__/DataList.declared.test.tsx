/**
 * DataList renders only what a field declares: badge colour from `colorMap`,
 * the title from an h3/h4 variant, the row click from `itemClickEvent`.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataList, type DataListField } from '../DataList';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

const Listen: React.FC<{ event: string; spy: (p: unknown) => void }> = ({ event, spy }) => {
  const bus = useEventBus();
  React.useEffect(() => bus.on(event, (e) => spy(e.payload)), [bus, event, spy]);
  return null;
};

const pill = (text: RegExp): string => screen.getByText(text).closest('.rounded-pill')?.className ?? '';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

const rows = [{ id: '1', name: 'Task One', status: 'failed', done: false, flag: 0 }];

describe('DataList badge colour', () => {
  it('uses the declared colorMap entry', () => {
    const fields: readonly DataListField[] = [
      { name: 'name', variant: 'h4' },
      { name: 'status', variant: 'badge', colorMap: { failed: 'success' } },
    ];
    wrap(<DataList entity={rows} fields={fields} />);
    expect(pill(/failed/i)).toContain('border-success');
  });

  it('control: an unmapped value is neutral, whatever the word', () => {
    wrap(<DataList entity={rows} fields={[{ name: 'name', variant: 'h4' }, { name: 'status', variant: 'badge' }]} />);
    const cls = pill(/failed/i);
    expect(cls).not.toContain('border-error');
    expect(cls).not.toContain('border-success');
  });

  it('message variant badges read the colorMap too', () => {
    const fields: readonly DataListField[] = [
      { name: 'name', variant: 'body' },
      { name: 'status', variant: 'badge', colorMap: { failed: 'warning' } },
    ];
    wrap(<DataList entity={rows} fields={fields} variant="message" />);
    expect(pill(/failed/i)).toContain('border-warning');
  });
});

describe('DataList title', () => {
  it('renders the declared h4 field as the title', () => {
    wrap(<DataList entity={rows} fields={[{ name: 'status' }, { name: 'name', variant: 'h4' }]} />);
    expect(screen.getByRole('heading', { name: 'Task One' })).toBeInTheDocument();
  });

  it('control: no h3/h4 field means no title row, not the first field', () => {
    wrap(<DataList entity={rows} fields={[{ name: 'name' }, { name: 'status' }]} />);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('DataList row click', () => {
  const actions = [{ event: 'OPEN', label: 'Open' }];

  it('emits the declared itemClickEvent', () => {
    const spy = vi.fn();
    const { container } = wrap(
      <>
        <Listen event="UI:ROW" spy={spy} />
        <DataList entity={rows} fields={[{ name: 'name', variant: 'h4' }]} itemActions={actions} itemClickEvent="ROW" />
      </>,
    );
    // The row opens through its one stretched control (the title), whose
    // ::after covers the row in a real layout.
    const row = container.querySelector('[data-entity-row]') as HTMLElement;
    fireEvent.click(row.querySelector('[role=button]:not([data-testid])') as HTMLElement);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('control: without itemClickEvent an action never becomes the row click', () => {
    const spy = vi.fn();
    const { container } = wrap(
      <>
        <Listen event="UI:OPEN" spy={spy} />
        <DataList entity={rows} fields={[{ name: 'name', variant: 'h4' }]} itemActions={actions} />
      </>,
    );
    const row = container.querySelector('[data-entity-row]') as HTMLElement;
    expect(row.className).not.toContain('cursor-pointer');
    fireEvent.click(row);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('DataList boolean', () => {
  it('format boolean renders Yes/No', () => {
    wrap(<DataList entity={rows} fields={[{ name: 'name', variant: 'h4' }, { name: 'flag', format: 'boolean' }]} />);
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('control: without format a numeric 0 is the number 0', () => {
    wrap(<DataList entity={rows} fields={[{ name: 'name', variant: 'h4' }, { name: 'flag' }]} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('No')).toBeNull();
  });

  it('control: without format the string "false" stays text', () => {
    wrap(<DataList entity={[{ id: '1', name: 'A', s: 'false' }]} fields={[{ name: 'name', variant: 'h4' }, { name: 's' }]} />);
    expect(screen.getByText('false')).toBeInTheDocument();
  });
});

describe('DataList message content', () => {
  it('renders the declared body field as the bubble text', () => {
    wrap(<DataList entity={[{ id: '1', who: 'ann', text: 'hello' }]} fields={[{ name: 'who' }, { name: 'text', variant: 'body' }]} variant="message" />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('control: with no declared content field no text is promoted to the bubble body', () => {
    wrap(<DataList entity={[{ id: '1', who: 'ann', text: 'hello' }]} fields={[{ name: 'who' }, { name: 'text' }]} variant="message" />);
    expect(screen.getByText('ann').className).toContain('text-xs');
    expect(screen.getByText('hello').className).toContain('text-xs');
  });
});
