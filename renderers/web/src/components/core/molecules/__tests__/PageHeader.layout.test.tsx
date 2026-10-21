/**
 * G-CROSS-018 — PageHeader meets Almadar_UX.md §2.1: title (+ icon) left,
 * at most 2 primary actions visible, the rest in an overflow menu; on a narrow
 * header only the first action stays visible and the others move into the
 * overflow, so nothing leaves the screen.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PageHeader } from '../PageHeader';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

const withBus = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

const four = [
  { label: 'Refresh', event: 'REFRESH', icon: 'refresh-cw' },
  { label: 'Export PDF', event: 'EXPORT_PDF', icon: 'file-text' },
  { label: 'Export CSV', event: 'EXPORT_CSV', icon: 'download' },
  { label: 'Archive', event: 'ARCHIVE', variant: 'danger' as const },
];

describe('PageHeader title icon', () => {
  it('renders the declared icon beside the title', async () => {
    const { container } = withBus(<PageHeader title="Executive Overview" icon="gauge" />);
    await waitFor(() => expect(container.querySelector('svg.lucide-gauge')).not.toBeNull());
    expect(screen.getByRole('heading', { name: 'Executive Overview' })).toBeTruthy();
  });

  it('control: no icon renders none', () => {
    const { container } = withBus(<PageHeader title="Executive Overview" />);
    expect(container.querySelector('svg.lucide-gauge')).toBeNull();
  });
});

describe('PageHeader actions', () => {
  it('shows the first two actions as buttons and puts the rest in the overflow menu', () => {
    withBus(<PageHeader title="Overview" actions={four} />);
    expect(screen.getByTestId('action-REFRESH')).toBeTruthy();
    expect(screen.getByTestId('action-EXPORT_PDF')).toBeTruthy();
    expect(screen.queryByTestId('action-EXPORT_CSV')).toBeNull();
    fireEvent.click(screen.getByTestId('page-header-overflow'));
    expect(screen.getByText('Export CSV')).toBeTruthy();
    expect(screen.getByText('Archive')).toBeTruthy();
  });

  it('an overflow item emits its event', () => {
    const seen = vi.fn();
    function Listener() {
      const bus = useEventBus();
      React.useEffect(() => bus.on('UI:EXPORT_CSV', seen), [bus]);
      return null;
    }
    withBus(<><PageHeader title="Overview" actions={four} /><Listener /></>);
    fireEvent.click(screen.getByTestId('page-header-overflow'));
    fireEvent.click(screen.getByText('Export CSV'));
    expect(seen).toHaveBeenCalled();
  });

  it('narrow: the compact overflow carries every action after the first', () => {
    withBus(<PageHeader title="Overview" actions={four} />);
    fireEvent.click(screen.getByTestId('page-header-overflow-compact'));
    for (const label of ['Export PDF', 'Export CSV', 'Archive']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('control: two actions need no wide overflow menu', () => {
    withBus(<PageHeader title="Overview" actions={four.slice(0, 2)} />);
    expect(screen.queryByTestId('page-header-overflow')).toBeNull();
    expect(screen.getByTestId('page-header-overflow-compact')).toBeTruthy();
  });

  it('edge: a single action needs no overflow at all', () => {
    withBus(<PageHeader title="Overview" actions={four.slice(0, 1)} />);
    expect(screen.queryByTestId('page-header-overflow')).toBeNull();
    expect(screen.queryByTestId('page-header-overflow-compact')).toBeNull();
  });

  it('edge: no actions renders only the title', () => {
    withBus(<PageHeader title="Overview" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('PageHeader spacing (Almadar_UI_Beauty.md §6 vertical rhythm)', () => {
  it('adds no outer margin — the parent stack owns the gap between sections', () => {
    const { container } = withBus(<PageHeader title="Overview" />);
    expect((container.firstElementChild as HTMLElement).className).not.toMatch(/\bm[bt]?-\d/);
  });
});

describe('PageHeader inside a flex row (std-contract regression, 2026-09-30)', () => {
  it('is not a size container, so a row sizing it from content cannot collapse it', () => {
    const { container } = withBus(<PageHeader title="Contracts" subtitle="Track status, value, and approvals" actions={four} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/@container/);
    expect(html).not.toMatch(/@sm\/page-header/);
  });

  it('switches compact vs wide actions on the viewport breakpoint', () => {
    withBus(<PageHeader title="Overview" actions={four} />);
    expect(screen.getByTestId('action-EXPORT_PDF').className).toContain('sm:inline-flex');
  });
});
