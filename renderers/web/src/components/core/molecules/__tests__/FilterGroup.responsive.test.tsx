/**
 * G-CROSS-018 — the default filter toolbar fits a phone: below md it collapses
 * to the existing popover trigger (Almadar_UX.md §1.2: primary controls
 * visible, the rest in a panel) instead of a bordered card crushing the
 * search box beside it. Wide, it stays inline.
 */
import React from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FilterGroup, type FilterDefinition } from '../FilterGroup';
import { EventBusProvider } from '../../../../core';

const filters: FilterDefinition[] = [
  { field: 'method', label: 'Method', options: ['GET', 'POST'] },
  { field: 'status', label: 'Status', options: ['active', 'disabled'] },
];

const withBus = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

function viewport(narrow: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: narrow && query === '(max-width: 767px)',
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('FilterGroup default toolbar across widths', () => {
  it('narrow: collapses to a Filters trigger that opens the controls', () => {
    viewport(true);
    withBus(<FilterGroup entity="Route" filters={filters} />);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    const trigger = screen.getByRole('button', { name: /filters/i });
    expect(trigger.getAttribute('aria-haspopup')).toBe('true');
    fireEvent.click(trigger);
    expect(screen.getByText('Method')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
  });

  it('control: wide keeps every filter inline', () => {
    viewport(false);
    withBus(<FilterGroup entity="Route" filters={filters} />);
    expect(screen.queryByRole('button', { name: /filters/i })).toBeNull();
    expect(screen.getByText('Method')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
  });

  it('edge: an explicit variant is honoured at any width', () => {
    viewport(true);
    withBus(<FilterGroup entity="Route" filters={filters} variant="vertical" />);
    expect(screen.queryByRole('button', { name: /filters/i })).toBeNull();
    expect(screen.getByText('Method')).toBeTruthy();
  });

  it('edge: no matchMedia (SSR, jsdom) renders the inline toolbar', () => {
    withBus(<FilterGroup entity="Route" filters={filters} />);
    expect(screen.queryByRole('button', { name: /filters/i })).toBeNull();
  });
});
