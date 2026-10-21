// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DetailPanel } from '../DetailPanel';
import type { DetailPanelProps } from '../DetailPanel';
import { EventBusProvider } from '../../../../core';

function renderPanel(props: DetailPanelProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EventBusProvider debug={false}>
          <DetailPanel {...props} />
        </EventBusProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const title = { name: 'name', label: 'Name', variant: 'h3' as const };

describe('DetailPanel looks', () => {
  it('panel (default) renders no look wrapper', () => {
    renderPanel({ entity: { id: '1', name: 'A' }, fields: [title] });
    expect(screen.queryByTestId(/detail-look-/)).toBeNull();
  });

  it('profile shows the cover and an avatar for the declared fields', () => {
    renderPanel({ look: 'profile', entity: { id: '1', name: 'Dana Ruiz', cover: 'https://x.test/c.jpg' }, fields: [title], coverField: 'cover', avatarField: 'photo' });
    expect(screen.getByTestId('detail-look-profile')).toBeTruthy();
    expect(screen.getByTestId('detail-cover')).toBeTruthy();
    expect(screen.getByText('DR')).toBeTruthy();
  });

  it('control: profile without a cover value draws no cover band', () => {
    renderPanel({ look: 'profile', entity: { id: '1', name: 'Dana' }, fields: [title], coverField: 'cover' });
    expect(screen.queryByTestId('detail-cover')).toBeNull();
  });

  it('profile shows an initials avatar with no avatarField declared', () => {
    renderPanel({ look: 'profile', entity: { id: '1', name: 'Dana Ruiz' }, fields: [title] });
    expect(screen.getByText('DR')).toBeTruthy();
  });

  it('control: panel look with no avatarField draws no avatar', () => {
    renderPanel({ entity: { id: '1', name: 'Dana Ruiz' }, fields: [title] });
    expect(screen.queryByText('DR')).toBeNull();
  });

  it('showcase leads with the declared media and switches images', () => {
    renderPanel({ look: 'showcase', entity: { id: '1', name: 'Chair', photos: ['https://x.test/1.jpg', 'https://x.test/2.jpg'] }, fields: [title], mediaField: 'photos' });
    const media = screen.getByTestId('detail-media');
    expect(within(media).getAllByRole('button', { name: /Show image/ })).toHaveLength(2);
    const thumb2 = screen.getByRole('button', { name: 'Show image 2' });
    fireEvent.click(thumb2);
    expect(thumb2.getAttribute('aria-pressed')).toBe('true');
  });

  it('control: showcase with no media value draws no media', () => {
    renderPanel({ look: 'showcase', entity: { id: '1', name: 'Chair' }, fields: [title], mediaField: 'photos' });
    expect(screen.queryByTestId('detail-media')).toBeNull();
  });

  it('workflow shows the declared stages with the record at its current stage, and the activity', () => {
    renderPanel({
      look: 'workflow',
      entity: { id: '1', name: 'Applicant', stage: 'interview' },
      fields: [title],
      stageField: 'stage',
      stages: [{ value: 'applied', label: 'Applied' }, { value: 'interview', label: 'Interview' }, { value: 'offer', label: 'Offer' }],
      activity: [{ id: 'a1', title: 'Phone screen done' }],
    });
    expect(within(screen.getByTestId('detail-stages')).getByText('Interview')).toBeTruthy();
    expect(within(screen.getByTestId('detail-activity')).getByText('Phone screen done')).toBeTruthy();
  });

  it('map draws the map region only when both coordinates are present', () => {
    const { unmount } = renderPanel({ look: 'map', entity: { id: '1', name: 'Van 4', lat: 51.5, lng: -0.12 }, fields: [title], latitudeField: 'lat', longitudeField: 'lng' });
    expect(screen.getByTestId('detail-map')).toBeTruthy();
    unmount();
    renderPanel({ look: 'map', entity: { id: '1', name: 'Van 4', lat: 51.5 }, fields: [title], latitudeField: 'lat', longitudeField: 'lng' });
    expect(screen.queryByTestId('detail-map')).toBeNull();
  });

  it('ledger shows line items and formatted totals', () => {
    renderPanel({
      look: 'ledger',
      entity: { id: '1', name: 'INV-7', subtotal: 100, tax: 20, total: 120 },
      fields: [title],
      lineItems: [{ id: 'l1', description: 'Widget', qty: 2 }],
      lineItemColumns: [{ key: 'description', header: 'Item' }, { key: 'qty', header: 'Qty' }],
      totals: [{ name: 'subtotal', label: 'Subtotal', format: 'currency' }, { name: 'total', label: 'Total', format: 'currency' }],
    });
    expect(within(screen.getByTestId('detail-line-items')).getByText('Widget')).toBeTruthy();
    const totals = screen.getByTestId('detail-totals');
    expect(within(totals).getByText('$120.00')).toBeTruthy();
    expect(within(totals).getByText('Subtotal')).toBeTruthy();
  });

  it('ledger totals declared as key/header (the std record field spec) show their labels and values', () => {
    renderPanel({
      look: 'ledger',
      entity: { id: '1', name: 'INV-7', subtotal: 100, tax: 20, total: 120 },
      fields: [title],
      lineItems: [{ id: 'l1', description: 'Widget', qty: 2 }],
      lineItemColumns: [{ key: 'description', header: 'Item' }],
      totals: [{ key: 'subtotal', header: 'Subtotal', format: 'currency' }, { key: 'total', header: 'Total', format: 'currency' }],
    });
    const totals = screen.getByTestId('detail-totals');
    expect(within(totals).getByText('$120.00')).toBeTruthy();
    expect(within(totals).getByText('Subtotal')).toBeTruthy();
    expect(within(totals).queryByText('—')).toBeNull();
  });

  it('conversation puts the thread beside the record facts', () => {
    renderPanel({
      look: 'conversation',
      entity: { id: '1', name: 'Ticket 9', owner: 'Sam' },
      fields: [title, { name: 'owner', label: 'Owner' }],
      thread: [{ id: 'm1', authorName: 'Ava', content: 'It broke again' }],
    });
    expect(within(screen.getByTestId('detail-thread')).getByText('It broke again')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
  });

  it('control: conversation with no thread says so', () => {
    renderPanel({ look: 'conversation', entity: { id: '1', name: 'Ticket 9' }, fields: [title] });
    expect(screen.getByText('No messages yet')).toBeTruthy();
  });

  it('workspace opens on the overview and shows a declared tab\'s fields when chosen', () => {
    renderPanel({
      look: 'workspace',
      entity: { id: '1', name: 'Acme', plan: 'Pro', seats: 12 },
      fields: [title, { name: 'plan', label: 'Plan' }, { name: 'seats', label: 'Seats', format: 'number' }],
      tabs: [{ id: 'billing', label: 'Billing', fields: ['plan', 'seats'] }],
    });
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Billing' }));
    expect(screen.getByRole('tab', { name: 'Billing' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByText('Pro').length).toBeGreaterThan(0);
  });
});

describe('DetailPanel looks — composed-in region content', () => {
  it('conversation places composed thread content (a child trait) in the thread region', () => {
    renderPanel({ look: 'conversation', entity: { id: '1', name: 'T' }, fields: [title], threadContent: <span>replies trait</span> });
    expect(within(screen.getByTestId('detail-thread')).getByText('replies trait')).toBeTruthy();
    expect(screen.queryByText('No messages yet')).toBeNull();
  });

  it('ledger places composed line-items content in the line-items region', () => {
    renderPanel({ look: 'ledger', entity: { id: '1', name: 'PO-1' }, fields: [title], lineItemsContent: <span>lines trait</span> });
    expect(within(screen.getByTestId('detail-line-items')).getByText('lines trait')).toBeTruthy();
  });

  it('workspace tab with composed content shows it when chosen', () => {
    renderPanel({ look: 'workspace', entity: { id: '1', name: 'Acme' }, fields: [title], tabs: [{ id: 'deals', label: 'Deals', content: <span>deals trait</span> }] });
    fireEvent.click(screen.getByRole('tab', { name: 'Deals' }));
    expect(screen.getByText('deals trait')).toBeTruthy();
  });

  it('workflow places composed activity content under the record', () => {
    renderPanel({ look: 'workflow', entity: { id: '1', name: 'A' }, fields: [title], activityContent: <span>history trait</span> });
    expect(within(screen.getByTestId('detail-activity')).getByText('history trait')).toBeTruthy();
  });
});

describe('DetailPanel looks — workflow off-ramp', () => {
  const stages = [{ value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Submitted' }, { value: 'approved', label: 'Approved' }];
  it('a stage off the declared lifecycle (rejected) draws no stepper', () => {
    renderPanel({ look: 'workflow', entity: { id: '1', name: 'CO-1', status: 'rejected' }, fields: [title], stageField: 'status', stages });
    expect(screen.queryByTestId('detail-stages')).toBeNull();
  });
  it('control: a declared stage draws the stepper', () => {
    renderPanel({ look: 'workflow', entity: { id: '1', name: 'CO-1', status: 'submitted' }, fields: [title], stageField: 'status', stages });
    expect(screen.getByTestId('detail-stages')).toBeTruthy();
  });
});

describe('DetailPanel looks — workspace tabs claim declared fields', () => {
  const fields = [title, { name: 'arr', label: 'Annual revenue', format: 'currency' as const }, { name: 'owner', label: 'Owner' }];
  const entity = { id: '1', name: 'Acme', arr: 120000, owner: 'Sam' };
  it('a claimed field leaves the overview and renders in its tab with its declared label and format', () => {
    renderPanel({ look: 'workspace', entity, fields, tabs: [{ id: 'money', label: 'Revenue', fields: ['arr'] }] });
    expect(screen.queryByText('Annual revenue')).toBeNull();
    expect(screen.getByText('Owner')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Revenue' }));
    expect(screen.getByText('Annual revenue')).toBeTruthy();
    expect(screen.getByText(/120,000/)).toBeTruthy();
  });
  it('control: a non-workspace look ignores tabs and keeps every field in place', () => {
    renderPanel({ entity, fields, tabs: [{ id: 'money', label: 'Revenue', fields: ['arr'] }] });
    expect(screen.getByText(/120,000/)).toBeTruthy();
  });
});

describe('DetailPanel looks — showcase reads an uploaded image file', () => {
  it('a file-typed image value leads the showcase', () => {
    renderPanel({ look: 'showcase', entity: { id: '1', name: 'Post', image: { name: 'beach.jpg', url: 'https://x.test/beach.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 } }, fields: [title], mediaField: 'image' });
    expect(screen.getByTestId('detail-media')).toBeTruthy();
  });
  it('control: a non-image file (pdf) is not shown as media', () => {
    renderPanel({ look: 'showcase', entity: { id: '1', name: 'Post', image: { name: 'a.pdf', url: 'https://x.test/a.pdf', mimeType: 'application/pdf', sizeBytes: 2048 } }, fields: [title], mediaField: 'image' });
    expect(screen.queryByTestId('detail-media')).toBeNull();
  });
});

describe('DetailPanel looks — workflow carries declared line items', () => {
  const stages = [{ value: 'pending', label: 'Pending' }, { value: 'ready', label: 'Ready' }];
  const cols = [{ key: 'name', header: 'Dish' }, { key: 'quantity', header: 'Qty' }];
  it('a workflow record with declared line items tables them', () => {
    renderPanel({ look: 'workflow', entity: { id: '1', name: 'T-12', status: 'pending' }, fields: [title], stageField: 'status', stages, lineItems: [{ name: 'Ramen', quantity: 2 }], lineItemColumns: cols });
    expect(within(screen.getByTestId('detail-line-items')).getByText('Ramen')).toBeTruthy();
  });
  it('control: a workflow record without line items draws no line-items block', () => {
    renderPanel({ look: 'workflow', entity: { id: '1', name: 'T-12', status: 'pending' }, fields: [title], stageField: 'status', stages });
    expect(screen.queryByTestId('detail-line-items')).toBeNull();
  });
});
