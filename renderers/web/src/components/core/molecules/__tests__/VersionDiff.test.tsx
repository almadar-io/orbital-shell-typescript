import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VersionDiff, type DiffHunk, type DiffLine, type DiffRevision } from '../VersionDiff';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

const translate = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core')>();
  return {
    ...actual,
    useTranslate: () => {
      translate.calls++;
      return actual.useTranslate();
    },
  };
});

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <EventBusProvider debug={false}>{children}</EventBusProvider>
);

const revisions: DiffRevision[] = [
  { id: 'r1', label: 'v1', author: 'Ada', content: 'title: Tasks\ncolor: blue' },
  { id: 'r2', label: 'v2', author: 'Agent', content: 'title: Tasks\ncolor: green' },
];

const hunks: DiffHunk[] = [
  {
    header: '@@ -1,2 +1,2 @@ orbitals/Task.orb',
    lines: [
      { type: 'context', beforeLineNumber: 1, afterLineNumber: 1, content: 'title: Tasks' },
      { type: 'removed', beforeLineNumber: 2, content: 'color: blue' },
      { type: 'added', afterLineNumber: 2, content: 'color: green' },
    ],
  },
];

function listen(event: string, listener: (e: { type: string; payload?: object }) => void): React.FC {
  return function Listener() {
    const bus = useEventBus();
    React.useEffect(() => bus.on(event, listener), [bus]);
    return null;
  };
}

describe('VersionDiff', () => {
  it('diffs two revisions: one line removed, one added, with revision pickers', () => {
    render(<Wrapper><VersionDiff revisions={revisions} /></Wrapper>);
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByText('-1')).toBeTruthy();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
  });

  it('the view toggle switches between side-by-side and inline', () => {
    render(<Wrapper><VersionDiff revisions={revisions} /></Wrapper>);
    expect(screen.queryAllByText('+', { exact: true })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /inline/i }));
    expect(screen.getAllByText('+', { exact: true }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /side-by-side/i }));
    expect(screen.queryAllByText('+', { exact: true })).toHaveLength(0);
  });

  it('control: view="inline" opens inline', () => {
    render(<Wrapper><VersionDiff revisions={revisions} view="inline" /></Wrapper>);
    expect(screen.getAllByText('+', { exact: true }).length).toBeGreaterThan(0);
  });

  it('revert emits UI:{revertEvent} with the "before" revision id', () => {
    const listener = vi.fn();
    const Listener = listen('UI:ROLLBACK', listener);
    render(<Wrapper><Listener /><VersionDiff revisions={revisions} revertEvent="ROLLBACK" /></Wrapper>);
    fireEvent.click(screen.getByRole('button', { name: /revert/i }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'UI:ROLLBACK', payload: { id: 'r1' } }));
  });

  it('control: no revert button without a revert handler or event', () => {
    render(<Wrapper><VersionDiff revisions={revisions} /></Wrapper>);
    expect(screen.queryByRole('button', { name: /revert/i })).toBeNull();
  });

  it('edge: a non-array revisions payload or a single revision renders without crashing', () => {
    const { rerender } = render(<Wrapper><VersionDiff revisions={{ not: 'an array' }} /></Wrapper>);
    expect(screen.getByText('+0')).toBeTruthy();
    rerender(<Wrapper><VersionDiff revisions={[revisions[0]]} /></Wrapper>);
    expect(screen.getByText('+0')).toBeTruthy();
  });

  it('hunks: renders a git diff\'s hunks (header, lines, stats) with no revision pickers', () => {
    render(<Wrapper><VersionDiff hunks={hunks} view="inline" /></Wrapper>);
    expect(screen.getByText('@@ -1,2 +1,2 @@ orbitals/Task.orb')).toBeTruthy();
    expect(screen.getByText('color: green')).toBeTruthy();
    expect(screen.getByText('color: blue')).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByText('-1')).toBeTruthy();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });

  it('hunks side-by-side: removed lines sit in the before column, added lines in the after column', () => {
    render(<Wrapper><VersionDiff hunks={hunks} /></Wrapper>);
    const before = screen.getByTestId('version-diff-before');
    const after = screen.getByTestId('version-diff-after');
    expect(before.textContent).toContain('color: blue');
    expect(before.textContent).not.toContain('color: green');
    expect(after.textContent).toContain('color: green');
  });

  it('edge: empty hunks show the no-changes message', () => {
    render(<Wrapper><VersionDiff hunks={[]} /></Wrapper>);
    expect(screen.getByTestId('version-diff-empty')).toBeTruthy();
  });
});

describe('VersionDiff — a re-render with the same diff renders nothing again', () => {
  function Host({ tick, diff }: { tick: number; diff: DiffHunk[] }) {
    return (
      <>
        <span data-tick={tick} />
        <VersionDiff hunks={diff} view="inline" />
      </>
    );
  }
  it('the parent re-rendering for anything else leaves the diff alone', () => {
    const { rerender } = render(<Host tick={0} diff={hunks} />, { wrapper: Wrapper });
    translate.calls = 0;
    rerender(<Host tick={1} diff={hunks} />);
    rerender(<Host tick={2} diff={hunks} />);
    expect(translate.calls).toBe(0);
  });

  it('control: a new diff renders', () => {
    const { rerender } = render(<Host tick={0} diff={hunks} />, { wrapper: Wrapper });
    translate.calls = 0;
    rerender(<Host tick={1} diff={[{ header: 'b', lines: [{ type: 'added', afterLineNumber: 1, content: 'x' }] }]} />);
    expect(translate.calls).toBeGreaterThan(0);
    expect(screen.getAllByText('x').length).toBeGreaterThan(0);
  });
});

describe('VersionDiff — long unchanged runs collapse to context', () => {
  const unchanged = (from: number, to: number): DiffLine[] =>
    Array.from({ length: to - from + 1 }, (_, i) => ({ type: 'unchanged' as const, beforeLineNumber: from + i, afterLineNumber: from + i, content: `line ${from + i}` }));
  const big: DiffHunk[] = [{
    header: 'schema.orb',
    lines: [...unchanged(1, 50), { type: 'added', afterLineNumber: 51, content: 'the change' }, ...unchanged(51, 100)],
  }];

  it('keeps three lines of context around a change and names what it hid', () => {
    render(<Wrapper><VersionDiff hunks={big} view="inline" /></Wrapper>);
    expect(screen.getByText('the change')).toBeTruthy();
    for (const n of [48, 49, 50, 51, 52, 53]) expect(screen.getByText(`line ${n}`)).toBeTruthy();
    expect(screen.queryByText('line 10')).toBeNull();
    expect(screen.queryByText('line 90')).toBeNull();
    const gaps = screen.getAllByTestId('version-diff-gap');
    expect(gaps).toHaveLength(2);
    expect(gaps[0].textContent).toContain('47');
    expect(gaps[1].textContent).toContain('47');
  });

  it('opening a gap shows the lines it hid', () => {
    render(<Wrapper><VersionDiff hunks={big} view="inline" /></Wrapper>);
    fireEvent.click(screen.getAllByTestId('version-diff-gap')[0]);
    expect(screen.getByText('line 10')).toBeTruthy();
    expect(screen.getAllByTestId('version-diff-gap')).toHaveLength(1);
  });

  it('control: a small diff shows every line and no gap', () => {
    const small: DiffHunk[] = [{ header: 'a', lines: [...unchanged(1, 5), { type: 'removed', beforeLineNumber: 6, content: 'gone' }, ...unchanged(6, 10)] }];
    render(<Wrapper><VersionDiff hunks={small} view="side-by-side" /></Wrapper>);
    expect(screen.queryByTestId('version-diff-gap')).toBeNull();
    expect(screen.getAllByText('line 1').length).toBeGreaterThan(0);
  });

  it('edge: context lines a caller chose are never collapsed', () => {
    const context: DiffHunk[] = [{
      header: 'b',
      lines: [...Array.from({ length: 20 }, (_, i) => ({ type: 'context' as const, beforeLineNumber: i + 1, afterLineNumber: i + 1, content: `ctx ${i + 1}` })), { type: 'added', afterLineNumber: 21, content: 'new' }],
    }];
    render(<Wrapper><VersionDiff hunks={context} view="inline" /></Wrapper>);
    expect(screen.getByText('ctx 1')).toBeTruthy();
    expect(screen.queryByTestId('version-diff-gap')).toBeNull();
  });
});
