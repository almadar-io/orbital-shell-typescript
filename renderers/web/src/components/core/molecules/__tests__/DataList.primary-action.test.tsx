/**
 * A custom-rendered row's PRIMARY action (variant primary) is the row's call to
 * action, so it shows in the row on every pointer — never hover-revealed, never
 * folded behind "⋯". Its other actions keep the hover cluster / kebab.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EntityRow } from '@almadar/core';
import { DataList, type DataListItemAction } from '../DataList';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

function Spy({ event, onFire }: { event: string; onFire: (p: object) => void }) {
  const bus = useEventBus();
  React.useEffect(() => bus.on(`UI:${event}`, (e) => onFire(e.payload ?? {})), [bus, event, onFire]);
  return null;
}

const rows = [{ id: 's1', title: 'Sunrise flow' }];
const renderRow = (item: EntityRow) => <span>{String(item.title)}</span>;
const hoverHidden = (el: HTMLElement) => el.closest('.opacity-0') !== null;
const coarseOnly = (el: HTMLElement) => el.closest('[class*="hidden [@media(pointer:coarse)]:block"]') !== null;
const fineOnly = (el: HTMLElement) => el.closest('[class*="[@media(pointer:coarse)]:hidden"]') !== null;

describe('DataList custom-row primary action', () => {
  const actions: DataListItemAction[] = [
    { label: 'Book class', event: 'BOOK_CLASS', variant: 'primary' },
    { label: 'Hide', event: 'HIDE' },
  ];

  it('shows the primary action in the row, outside the hover cluster, on every pointer', () => {
    render(
      <EventBusProvider debug={false}>
        <DataList entity={rows} itemActions={actions} renderItem={renderRow} />
      </EventBusProvider>,
    );
    const book = screen.getByRole('button', { name: /Book class/ });
    expect(hoverHidden(book)).toBe(false);
    expect(coarseOnly(book)).toBe(false);
    expect(fineOnly(book)).toBe(false);
  });

  it('fires the primary action with the row', () => {
    const onFire = vi.fn();
    render(
      <EventBusProvider debug={false}>
        <Spy event="BOOK_CLASS" onFire={onFire} />
        <DataList entity={rows} itemActions={actions} renderItem={renderRow} />
      </EventBusProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Book class/ }));
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire.mock.calls[0][0]).toMatchObject({ id: 's1' });
  });

  it('control: a non-primary action stays in the hover-revealed cluster', () => {
    render(
      <EventBusProvider debug={false}>
        <DataList entity={rows} itemActions={actions} renderItem={renderRow} />
      </EventBusProvider>,
    );
    const hide = screen.getByRole('button', { name: /Hide/ });
    expect(hoverHidden(hide)).toBe(true);
  });

  it('edge: a row with only a primary action renders no hover cluster at all', () => {
    const { container } = render(
      <EventBusProvider debug={false}>
        <DataList entity={rows} itemActions={[actions[0]]} renderItem={renderRow} />
      </EventBusProvider>,
    );
    expect(container.querySelector('.opacity-0')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Book class/ })).toHaveLength(1);
  });
});
