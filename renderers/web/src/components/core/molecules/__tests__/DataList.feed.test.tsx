/**
 * The `feed` variant lays every row out left-aligned under its author, as a
 * team chat reads: one author header for consecutive rows from the same sender
 * inside the grouping window, a replies line that emits its own event, and the
 * row actions as icon buttons.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataList } from '../DataList';
import { EventBusProvider, useEventBus } from '../../../../core';

const withBus = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

const fields = [{ name: 'content', variant: 'body' as const }, { name: 'sentAt', format: 'datetime' as const }];

const row = (id: string, sender: string, name: string, sentAt: string, extra: Record<string, string | number | string[]> = {}) =>
  ({ id, content: `text ${id}`, sender, senderName: name, sentAt, ...extra });

describe('DataList feed variant', () => {
  it('shows one author header for consecutive rows from one sender inside the window', () => {
    const rows = [
      row('a', 'u1', 'Ana Novak', '2026-11-24T09:00:00Z'),
      row('b', 'u1', 'Ana Novak', '2026-11-24T09:03:00Z'),
    ];
    const { container } = withBus(<DataList entity={rows} variant="feed" fields={fields} senderField="sender" senderLabelField="senderName" />);
    expect(screen.getAllByText('Ana Novak')).toHaveLength(1);
    expect(container.querySelectorAll('[data-feed-continuation]')).toHaveLength(1);
  });

  it('starts a new header when the gap passes the window (control)', () => {
    const rows = [
      row('a', 'u1', 'Ana Novak', '2026-11-24T09:00:00Z'),
      row('b', 'u1', 'Ana Novak', '2026-11-24T09:30:00Z'),
    ];
    const { container } = withBus(<DataList entity={rows} variant="feed" fields={fields} senderField="sender" senderLabelField="senderName" />);
    expect(container.querySelectorAll('[data-feed-continuation]')).toHaveLength(0);
  });

  it('starts a new header when the sender changes (control)', () => {
    const rows = [
      row('a', 'u1', 'Ana Novak', '2026-11-24T09:00:00Z'),
      row('b', 'u2', 'Bor Kranjc', '2026-11-24T09:01:00Z'),
    ];
    const { container } = withBus(<DataList entity={rows} variant="feed" fields={fields} senderField="sender" senderLabelField="senderName" />);
    expect(container.querySelectorAll('[data-feed-continuation]')).toHaveLength(0);
  });

  it('never right-aligns the viewer’s own rows', () => {
    const rows = [row('a', 'u1', 'Ana Novak', '2026-11-24T09:00:00Z')];
    const { container } = withBus(<DataList entity={rows} variant="feed" fields={fields} senderField="sender" currentUser="u1" />);
    const el = container.querySelector('[data-entity-row]');
    expect(el?.className).not.toContain('justify-end');
  });

  it('shows the replies line only above zero and emits replyEvent with the row', () => {
    const seen = vi.fn();
    const Probe = () => {
      const bus = useEventBus();
      React.useEffect(() => bus.on('UI:OPEN_THREAD', (e) => seen(e.payload)), [bus]);
      return null;
    };
    const rows = [
      row('a', 'u1', 'Ana Novak', '2026-11-24T09:00:00Z', { replyCount: 2, repliers: ['Bor Kranjc', 'Cene Zupan'] }),
      row('b', 'u2', 'Bor Kranjc', '2026-11-24T09:10:00Z', { replyCount: 0 }),
    ];
    withBus(
      <>
        <Probe />
        <DataList entity={rows} variant="feed" fields={fields} senderField="sender" senderLabelField="senderName" replyCountField="replyCount" repliersField="repliers" replyEvent="OPEN_THREAD" />
      </>,
    );
    const lines = screen.getAllByTestId('feed-replies');
    expect(lines).toHaveLength(1);
    fireEvent.click(lines[0]);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('renders row actions as labelled icon buttons', () => {
    const rows = [row('a', 'u1', 'Ana Novak', '2026-11-24T09:00:00Z')];
    withBus(<DataList entity={rows} variant="feed" fields={fields} senderField="sender" itemActions={[{ label: 'Reply in thread', event: 'REPLY', icon: 'message-square' }]} />);
    expect(screen.getAllByRole('button', { name: 'Reply in thread' }).length).toBeGreaterThan(0);
  });
});
