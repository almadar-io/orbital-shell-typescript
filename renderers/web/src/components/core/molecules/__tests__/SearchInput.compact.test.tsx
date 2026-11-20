/**
 * A suggestion may carry a badge (its kind, in its own colour). With `expandOnCompact`, a phone-width screen draws a
 * search button that opens the box full screen, its suggestions listed under it; picking one closes the view.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { SearchInput } from '../SearchInput';
import { EventBusProvider, useEventBus, MOBILE_MEDIA_QUERY } from '../../../../core';

function Listen({ type, fn }: { type: string; fn: (e: { payload?: Record<string, unknown> }) => void }): null {
  const bus = useEventBus();
  React.useEffect(() => bus.on(type, fn), [bus, type, fn]);
  return null;
}

const suggestions = [
  { label: 'Ana Novak', value: '/people/1', badge: 'Person', badgeVariant: 'info' as const },
  { label: 'Annual report', value: '/tasks/7', badge: 'Task', badgeVariant: 'warning' as const },
  { label: 'Anything else', value: '/x' },
];

function phone(isPhone: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: isPhone && q === MOBILE_MEDIA_QUERY,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function setup(props: Partial<React.ComponentProps<typeof SearchInput>> = {}) {
  const picked = vi.fn();
  render(
    <EventBusProvider debug={false}>
      <Listen type="UI:PICK" fn={picked} />
      <SearchInput suggestionEvent="PICK" suggestions={suggestions} value="An" placeholder="Search people…" {...props} />
    </EventBusProvider>,
  );
  return { picked };
}

afterEach(() => vi.unstubAllGlobals());

describe('SearchInput suggestion badges', () => {
  it('draws each suggestion badge in its declared colour', () => {
    phone(false);
    setup();
    fireEvent.focus(screen.getByRole('combobox'));
    const options = screen.getAllByRole('option');
    expect(within(options[0]).getByText('Person').closest('[data-variant]')?.getAttribute('data-variant')).toBe('info');
    expect(within(options[1]).getByText('Task').closest('[data-variant]')?.getAttribute('data-variant')).toBe('warning');
  });

  it('control: a suggestion with no badge draws none', () => {
    phone(false);
    setup();
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option')[2].querySelector('[data-variant]')).toBeNull();
  });
});

describe('SearchInput expandOnCompact', () => {
  it('on a phone draws a search button that opens the box full screen with its suggestions', async () => {
    phone(true);
    const { picked } = setup({ expandOnCompact: true });
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Search people…' }));
    const dialog = screen.getByRole('dialog');
    const box = within(dialog).getByRole('combobox');
    expect(document.activeElement).toBe(box);
    expect(within(dialog).getAllByRole('option').map((o) => o.querySelector('[data-suggestion-label]')?.textContent))
      .toEqual(['Ana Novak', 'Annual report', 'Anything else']);
    fireEvent.mouseDown(within(dialog).getByText('Annual report'));
    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ payload: { value: '/tasks/7', label: 'Annual report' } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('the full-screen view closes on Cancel and keeps the typed text', async () => {
    phone(true);
    setup({ expandOnCompact: true });
    fireEvent.click(screen.getByRole('button', { name: 'Search people…' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox'), { target: { value: 'Ann' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Search people…' }).textContent).toContain('Ann');
  });

  it('control: on a wide screen the box stays inline', () => {
    phone(false);
    setup({ expandOnCompact: true });
    expect(screen.getByRole('combobox')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('control: without expandOnCompact a phone keeps the inline box', () => {
    phone(true);
    setup();
    expect(screen.getByRole('combobox')).toBeTruthy();
  });
});
