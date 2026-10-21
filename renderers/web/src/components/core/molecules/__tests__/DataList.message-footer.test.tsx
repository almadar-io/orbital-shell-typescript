/**
 * A chat bubble (DataList `message` variant) is capped at 75% of the pane, so
 * on a phone its footer — timestamp + inline actions — must wrap instead of
 * spilling out of the bubble, and the timestamp must stay on one line.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataList } from '../DataList';
import { EventBusProvider } from '../../../../core';

const withBus = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

const rows = [{ id: 'm1', content: 'Canyon Yonder', timestamp: '2026-10-12T10:00:00Z', sender: 'u2' }];
const actions = [{ label: 'Open', event: 'VIEW', variant: 'ghost' as const }, { label: 'React', event: 'REACT', variant: 'ghost' as const }];

describe('DataList message bubble footer', () => {
  it('wraps the footer so actions drop below the timestamp when the bubble is narrow', () => {
    withBus(<DataList entity={rows} variant="message" fields={[{ name: 'content' }, { name: 'timestamp', format: 'date' }]} itemActions={actions} maxInlineActions={2} senderField="sender" currentUser="u1" />);
    const footer = screen.getAllByRole('button', { name: /open/i }).find((el) => el.tagName === 'BUTTON')?.closest('[class*="justify-between"]');
    expect(footer?.className).toContain('flex-wrap');
  });

  it('keeps the timestamp on one line', () => {
    withBus(<DataList entity={rows} variant="message" fields={[{ name: 'content' }, { name: 'timestamp', format: 'date' }]} itemActions={actions} maxInlineActions={2} senderField="sender" currentUser="u1" />);
    const footer = screen.getAllByRole('button', { name: /open/i }).find((el) => el.tagName === 'BUTTON')?.closest('[class*="justify-between"]');
    expect(footer?.firstElementChild?.className).toContain('whitespace-nowrap');
  });
});
