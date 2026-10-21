import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommitRow } from '../CommitRow';
import { ChangeList } from '../ChangeList';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <EventBusProvider debug={false}>{children}</EventBusProvider>
);

function listen(event: string, listener: (e: { type: string; payload?: object }) => void): React.FC {
  return function Listener() {
    const bus = useEventBus();
    React.useEffect(() => bus.on(event, listener), [bus]);
    return null;
  };
}

const commit = { sha: '9f3c2a1b7e', message: 'Add a discount field', author: 'Ada', timestamp: '2 min ago' };

describe('CommitRow', () => {
  it('shows the message, short sha, author, time and kind', () => {
    render(<Wrapper><CommitRow {...commit} kind="agent" additions={3} deletions={1} /></Wrapper>);
    expect(screen.getByText('Add a discount field')).toBeTruthy();
    expect(screen.getByText('9f3c2a1')).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('2 min ago')).toBeTruthy();
    expect(screen.getByTestId('commit-row-kind').getAttribute('data-kind')).toBe('agent');
    expect(screen.getByText('+3')).toBeTruthy();
    expect(screen.getByText('-1')).toBeTruthy();
  });

  it('a merge of a teammate\'s work is its own kind of version', () => {
    render(<Wrapper><CommitRow {...commit} kind="merge" /></Wrapper>);
    expect(screen.getByTestId('commit-row-kind').getAttribute('data-kind')).toBe('merge');
  });

  it('clicking the row emits UI:{selectEvent} with the sha', () => {
    const listener = vi.fn();
    const Listener = listen('UI:HISTORY_SELECT', listener);
    render(<Wrapper><Listener /><CommitRow {...commit} selectEvent="HISTORY_SELECT" /></Wrapper>);
    fireEvent.click(screen.getByTestId('commit-row'));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: { sha: '9f3c2a1b7e' } }));
  });

  it('Restore emits UI:{restoreEvent} with the sha, without also selecting the row', () => {
    const restore = vi.fn();
    const select = vi.fn();
    const R = listen('UI:HISTORY_RESTORE', restore);
    const S = listen('UI:HISTORY_SELECT', select);
    render(<Wrapper><R /><S /><CommitRow {...commit} selectEvent="HISTORY_SELECT" restoreEvent="HISTORY_RESTORE" /></Wrapper>);
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ payload: { sha: '9f3c2a1b7e' } }));
    expect(select).not.toHaveBeenCalled();
  });

  it('control: the current version has no Restore, and no restoreEvent means no Restore', () => {
    const { rerender } = render(<Wrapper><CommitRow {...commit} current restoreEvent="HISTORY_RESTORE" /></Wrapper>);
    expect(screen.queryByRole('button', { name: /restore/i })).toBeNull();
    expect(screen.getByTestId('commit-row-current')).toBeTruthy();
    rerender(<Wrapper><CommitRow {...commit} /></Wrapper>);
    expect(screen.queryByRole('button', { name: /restore/i })).toBeNull();
  });

  it('edge: no author, time, kind or stats renders just the message and sha; a short sha is shown whole', () => {
    render(<Wrapper><CommitRow sha="abc" message="init" /></Wrapper>);
    expect(screen.getByText('abc')).toBeTruthy();
    expect(screen.queryByTestId('commit-row-kind')).toBeNull();
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it('selected marks the row pressed', () => {
    render(<Wrapper><CommitRow {...commit} selected selectEvent="HISTORY_SELECT" /></Wrapper>);
    expect(screen.getByTestId('commit-row').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('ChangeList', () => {
  const changes = [
    { type: 'added' as const, title: 'DiscountOrbital', description: 'New orbital' },
    { type: 'modified' as const, title: 'Order.total', description: 'Now includes discount', before: 'total: number', after: 'total: money' },
    { type: 'removed' as const, title: 'LegacyPage', description: 'Page removed' },
  ];

  it('lists each change with its kind, and before/after for a modification', () => {
    render(<Wrapper><ChangeList changes={changes} /></Wrapper>);
    expect(screen.getAllByTestId('change-list-item').map((el) => el.getAttribute('data-change-type'))).toEqual(['added', 'modified', 'removed']);
    expect(screen.getByText('total: number')).toBeTruthy();
    expect(screen.getByText('total: money')).toBeTruthy();
  });

  it('Inspect emits UI:{inspectEvent} with the change; control: no inspectEvent, no button', () => {
    const listener = vi.fn();
    const Listener = listen('UI:INSPECT_CHANGE', listener);
    const { rerender } = render(<Wrapper><Listener /><ChangeList changes={[changes[0]]} inspectEvent="INSPECT_CHANGE" /></Wrapper>);
    fireEvent.click(screen.getByRole('button', { name: /inspect/i }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: { title: 'DiscountOrbital', type: 'added' } }));
    rerender(<Wrapper><Listener /><ChangeList changes={[changes[0]]} /></Wrapper>);
    expect(screen.queryByRole('button', { name: /inspect/i })).toBeNull();
  });

  it('edge: no changes shows the empty message; a non-array payload is treated as none', () => {
    const { rerender } = render(<Wrapper><ChangeList changes={[]} /></Wrapper>);
    expect(screen.getByTestId('change-list-empty')).toBeTruthy();
    rerender(<Wrapper><ChangeList changes={{ not: 'a list' }} /></Wrapper>);
    expect(screen.getByTestId('change-list-empty')).toBeTruthy();
  });
});
