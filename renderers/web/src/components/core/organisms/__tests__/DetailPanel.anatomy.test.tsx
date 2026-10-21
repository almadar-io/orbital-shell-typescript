// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DetailPanel } from '../DetailPanel';
import type { DetailPanelProps } from '../DetailPanel';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

function Spy({ event, onEvent }: { event: string; onEvent: () => void }) {
  const bus = useEventBus();
  React.useEffect(() => bus.on(event, onEvent), [bus, event, onEvent]);
  return null;
}

function renderPanel(props: DetailPanelProps, spy?: { event: string; onEvent: () => void }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EventBusProvider debug={false}>
          {spy && <Spy event={spy.event} onEvent={spy.onEvent} />}
          <DetailPanel {...props} />
        </EventBusProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const record = {
  id: '1',
  title: 'CO-12',
  status: 'draft',
  owner: 'Dana',
  cost: 2500,
  days: 4,
  requestedAt: '2026-08-15T21:56:18.495Z',
  reason: 'Client asked for a wider door.',
};

const fields = [
  { name: 'title', label: 'Title', variant: 'h3' as const },
  { name: 'status', label: 'Status', variant: 'badge' as const },
  { name: 'owner', label: 'Owner' },
  { name: 'cost', label: 'Cost impact', format: 'currency' as const },
  { name: 'days', label: 'Schedule days', format: 'number' as const },
  { name: 'requestedAt', label: 'Requested', format: 'date' as const },
  { name: 'reason', label: 'Reason', variant: 'body' as const },
];

describe('DetailPanel anatomy', () => {
  it('declared money/number fields render in the key-figures strip, not in the field grid', () => {
    renderPanel({ entity: record, fields });
    const strip = screen.getByTestId('detail-key-figures');
    expect(within(strip).getByText('Cost impact')).toBeTruthy();
    expect(within(strip).getByText('$2,500.00')).toBeTruthy();
    expect(within(strip).getByText('Schedule days')).toBeTruthy();
    expect(within(screen.getByTestId('detail-fields')).queryByText('Cost impact')).toBeNull();
  });

  it('control: no key-figures strip when no money/number/progress field is declared', () => {
    renderPanel({ entity: record, fields: [fields[0], fields[2]] });
    expect(screen.queryByTestId('detail-key-figures')).toBeNull();
  });

  it('dates get their own headed section next to the overview fields', () => {
    renderPanel({ entity: record, fields });
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Timeline' })).toBeTruthy();
  });

  it('control: a single field section draws no section heading', () => {
    renderPanel({ entity: record, fields: [fields[0], fields[2]] });
    expect(screen.queryByRole('heading', { name: 'Overview' })).toBeNull();
    expect(screen.getByText('Owner')).toBeTruthy();
  });

  it('prose fields render full width, outside the field grid', () => {
    renderPanel({ entity: record, fields });
    const prose = screen.getByTestId('detail-prose');
    expect(within(prose).getByText('Client asked for a wider door.')).toBeTruthy();
    expect(within(screen.getByTestId('detail-fields')).queryByText('Client asked for a wider door.')).toBeNull();
  });

  it('explicit sections keep their headings instead of being flattened', () => {
    renderPanel({
      entity: record,
      fields: ['title'],
      sections: [
        { title: 'Parties', fields: [{ label: 'Owner', value: 'Dana' }] },
        { title: 'Money', fields: [{ label: 'Cost', value: '$2,500' }] },
      ],
    });
    expect(screen.getByRole('heading', { name: 'Parties' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Money' })).toBeTruthy();
  });

  it('the slide-over draws no card inside the panel and a scrim that dismisses through closeEvent', () => {
    const onClose = vi.fn();
    renderPanel(
      {
        entity: record,
        fields,
        slideOver: true,
        closeEvent: 'CLOSE_VIEW',
        actions: [{ label: 'Close', event: 'CLOSE_VIEW' }],
      },
      { event: 'UI:CLOSE_VIEW', onEvent: onClose },
    );
    const panel = screen.getByTestId('detail-slide-over');
    expect(panel.querySelector('[data-testid="detail-card"]')).toBeNull();
    fireEvent.click(screen.getByTestId('detail-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('control: a slide-over without a closeEvent has an inert scrim', () => {
    const onClose = vi.fn();
    renderPanel({ entity: record, fields, slideOver: true }, { event: 'UI:CLOSE_VIEW', onEvent: onClose });
    fireEvent.click(screen.getByTestId('detail-scrim'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a routed (non slide-over) panel renders inside the detail card', () => {
    renderPanel({ entity: record, fields });
    expect(screen.getByTestId('detail-card')).toBeTruthy();
  });
});

describe('DetailPanel declared-sections edge cases', () => {
  it('an empty sections array (std-record-detail default) still renders the field slots', () => {
    renderPanel({ entity: record, fields, sections: [] });
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Timeline' })).toBeTruthy();
  });

  it('sections listing field names resolve them against the record', () => {
    renderPanel({ entity: record, fields, sections: [{ title: 'People', fields: ['owner'] }, { title: 'When', fields: ['requestedAt'] }] });
    expect(screen.getByRole('heading', { name: 'People' })).toBeTruthy();
    expect(screen.getByText('Dana')).toBeTruthy();
  });
});

describe('DetailPanel status-gated actions', () => {
  const gated = [
    { label: 'Submit for approval', event: 'SUBMIT_FOR_APPROVAL', variant: 'primary' as const, when: ['fn', 'row', ['=', ['object/get', '@row', 'status'], 'draft']] },
    { label: 'Approve', event: 'APPROVE', variant: 'primary' as const, when: ['fn', 'row', ['=', ['object/get', '@row', 'status'], 'pending-approval']] },
  ];

  it('shows only the actions whose declared when holds for the record', () => {
    renderPanel({ entity: record, fields, actions: gated });
    expect(screen.getByText('Submit for approval')).toBeTruthy();
    expect(screen.queryByText('Approve')).toBeNull();
  });
});

describe('DetailPanel value rendering', () => {
  it('a declared format wins over the schema type (datetime declared as date shows no time)', () => {
    renderPanel({ entity: { id: '1', at: '2026-08-15T21:56:18.495Z' }, fields: [{ name: 'at', label: 'At', format: 'date', type: 'datetime' }] });
    expect(screen.queryByText(/AM|PM|:\d\d/)).toBeNull();
    expect(screen.getByText(/2026/)).toBeTruthy();
  });

  it('control: an undeclared-format datetime field keeps date and time', () => {
    renderPanel({ entity: { id: '1', at: '2026-08-15T21:56:18.495Z' }, fields: [{ name: 'at', label: 'At', type: 'datetime' }] });
    expect(screen.getByText(/2026.*\d{1,2}:\d{2}/)).toBeTruthy();
  });

  it('a url field renders as a link even when it ends in an image extension (no extension guessing)', () => {
    renderPanel({ entity: { id: '1', site: 'https://x.test/logo.png' }, fields: [{ name: 'site', label: 'Site', type: 'url' }] });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'https://x.test/logo.png' })).toBeTruthy();
  });

  it('a declared image field renders the Image atom', () => {
    renderPanel({ entity: { id: '1', photo: 'https://x.test/p' }, fields: [{ name: 'photo', label: 'Photo', type: 'image' }] });
    expect(screen.getByRole('img')).toBeTruthy();
  });
});

describe('DetailPanel boolean badges', () => {
  const field = { name: 'isActive', label: 'Status', variant: 'badge' as const, colorMap: { true: 'success' as const, false: 'neutral' as const }, labels: { true: 'Active', false: 'Disabled' } };

  it('a false boolean badge still renders its declared label', () => {
    renderPanel({ entity: { id: '1', isActive: false }, fields: [field] });
    expect(screen.getByText('Disabled')).toBeTruthy();
  });

  it('control: a true boolean badge renders its label', () => {
    renderPanel({ entity: { id: '1', isActive: true }, fields: [field] });
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('control: an absent value draws no badge', () => {
    renderPanel({ entity: { id: '1' }, fields: [field] });
    expect(screen.queryByText('Disabled')).toBeNull();
    expect(screen.queryByText('Active')).toBeNull();
  });
});

describe('DetailPanel declared action payloads', () => {
  it('an inline action emits { id, row } plus its declared payload', () => {
    const onEvent = vi.fn();
    renderPanel(
      { entity: record, fields, actions: [{ label: 'Mark ready', event: 'MARK_READY', variant: 'primary', payload: ['fn', 'row', { ticketId: ['object/get', '@row', 'id'], readyAt: 'now' }] }] },
      { event: 'UI:MARK_READY', onEvent },
    );
    fireEvent.click(screen.getByText('Mark ready'));
    expect(onEvent).toHaveBeenCalledTimes(1);
    const payload = onEvent.mock.calls[0][0].payload;
    expect(payload).toMatchObject({ id: '1', ticketId: '1', readyAt: 'now' });
    expect(payload.row).toMatchObject({ id: '1', title: 'CO-12' });
  });

  it('control: an action without payload emits exactly { id, row }', () => {
    const onEvent = vi.fn();
    renderPanel({ entity: record, fields, actions: [{ label: 'Open', event: 'OPEN', variant: 'primary' }] }, { event: 'UI:OPEN', onEvent });
    fireEvent.click(screen.getByText('Open'));
    expect(Object.keys(onEvent.mock.calls[0][0].payload).sort()).toEqual(['id', 'row']);
  });
});

describe('DetailPanel datetime format', () => {
  it('a datetime field joins the Timeline section and shows date and time', () => {
    renderPanel({ entity: { id: '1', owner: 'Dana', startTime: '2026-08-15T09:30:00Z' }, fields: [{ name: 'owner', label: 'Owner' }, { name: 'startTime', label: 'Starts', format: 'datetime' }] });
    expect(screen.getByRole('heading', { name: 'Timeline' })).toBeTruthy();
    expect(screen.getByText(/2026.*\d{1,2}:\d{2}/)).toBeTruthy();
  });
});
