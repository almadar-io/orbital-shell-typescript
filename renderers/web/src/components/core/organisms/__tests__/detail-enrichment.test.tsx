/**
 * DetailPanel schema enrichment + backAction placement.
 *
 * (1) A detail-panel pattern rendered through SlotContentRenderer gets its
 * {key, header} fields enriched from the entity schema (runtime twin of the
 * compiled path's injection): date fields render formatted (not raw ISO),
 * union-valued fields render as humanized badges (not raw tokens).
 * (2) The first-class `backAction` prop renders top-LEFT (Almadar_UX §8.4),
 * spatially separated from the right-aligned actions + close X.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SlotContentRenderer } from '../UISlotRenderer';
import { DetailPanel } from '../DetailPanel';
import { UISlotProvider } from '../../../../providers/UISlotContext';
import { EntitySchemaProvider } from '../../../../providers/EntitySchemaContext';
import { EventBusProvider } from '../../../../core';
import type { ResolvedEntity } from '@almadar/core';

const patientEntity: ResolvedEntity = {
  name: 'Patient',
  collection: 'patients',
  fields: [
    { name: 'id', type: 'string', tsType: 'string', required: true, default: undefined, description: undefined, values: undefined, enumValues: undefined, relation: undefined },
    { name: 'name', type: 'string', tsType: 'string', required: true, default: undefined, description: undefined, values: undefined, enumValues: undefined, relation: undefined },
    { name: 'dateOfBirth', type: 'date', tsType: 'string', required: false, default: undefined, description: undefined, values: undefined, enumValues: undefined, relation: undefined },
    { name: 'status', type: 'string', tsType: 'string', required: false, default: undefined, description: undefined, values: ['checked_in', 'discharged'], enumValues: ['checked_in', 'discharged'], relation: undefined },
  ],
  runtime: false,
  shared: undefined,
  hasInstances: false,
  instances: undefined,
  defaults: undefined,
  usedByTraits: [],
  usedByPages: [],
};

const detailContent = {
  id: 'detail-test',
  pattern: 'detail-panel',
  priority: 0,
  sourceTrait: 'PatientDetail',
  props: {
    entity: {
      id: 'p1',
      name: 'Maya Chen',
      dateOfBirth: '1988-03-14T00:00:00.000Z',
      status: 'checked_in',
    },
    fields: [
      { key: 'name' },
      { key: 'dateOfBirth', header: 'DOB' },
      { key: 'status' },
    ],
    showActions: true,
  },
};

function Harness({ children }: { children: React.ReactNode }): React.ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EventBusProvider debug={false}>
          <EntitySchemaProvider
            entities={[patientEntity]}
            traitLinkedEntities={new Map([['PatientDetail', 'Patient']])}
            orbitalsByTrait={new Map([['PatientDetail', 'PatientOrbital']])}
          >
            <UISlotProvider>{children}</UISlotProvider>
          </EntitySchemaProvider>
        </EventBusProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('detail-panel schema enrichment (runtime path)', () => {
  it('renders a date field formatted, not as a raw ISO string', () => {
    render(
      <Harness>
        <SlotContentRenderer content={detailContent} onDismiss={() => {}} />
      </Harness>,
    );
    expect(screen.queryByText('1988-03-14T00:00:00.000Z')).not.toBeInTheDocument();
    expect(screen.getByText(/March 14, 1988/)).toBeInTheDocument();
  });

  it('renders a union-valued field as a badge showing the stored value (no English prettifying)', () => {
    render(
      <Harness>
        <SlotContentRenderer content={detailContent} onDismiss={() => {}} />
      </Harness>,
    );
    expect(screen.getByText('checked_in')).toBeInTheDocument();
    expect(screen.queryByText('Checked In')).toBeNull();
  });
});

describe('DetailPanel header layout', () => {
  function renderPanel(props: Partial<React.ComponentProps<typeof DetailPanel>>) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <EventBusProvider debug={false}>
            <DetailPanel
              entity={{ id: '1', name: 'Opening A' }}
              fields={['name']}
              {...props}
            />
          </EventBusProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('renders backAction in the left group, actions + declared close in the right group', () => {
    const { container } = renderPanel({
      backAction: { label: 'Back to openings', event: 'BACK' },
      actions: [
        { label: 'Edit', event: 'EDIT', variant: 'primary' },
        { label: 'Close', event: 'CLOSE_VIEW', variant: 'ghost' },
      ],
      closeEvent: 'CLOSE_VIEW',
    });

    const back = screen.getByTestId('action-BACK');
    const edit = screen.getByTestId('action-EDIT');
    const close = screen.getByTestId('action-CLOSE_VIEW');
    expect(back).toBeInTheDocument();

    // The back button must live in a DIFFERENT flex group than edit/close,
    // and precede them in document order (left before right).
    expect(back.parentElement).not.toBe(edit.parentElement);
    expect(edit.parentElement).toBe(close.parentElement);
    const order = back.compareDocumentPosition(edit);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="action-BACK"]').length).toBe(1);
  });

  it('renders NO close × when the call site declares no close action', () => {
    // The close affordance is presence-gated: a routed detail page (no
    // declared close) must not show a dismiss × — the shell's Back owns
    // navigation. The old synthetic fallback (always-rendered ×, emitting
    // a payload-less UI:CLOSE nobody listens to) was the defect.
    renderPanel({ actions: [{ label: 'Edit', event: 'EDIT', variant: 'primary' }] });
    expect(screen.queryByTestId('action-close')).not.toBeInTheDocument();
    expect(screen.getByTestId('action-EDIT')).toBeInTheDocument();
  });

  it('collapses actions beyond maxInlineActions (default 2) into the overflow menu', () => {
    renderPanel({
      actions: [
        { label: 'Edit', event: 'EDIT', variant: 'primary' },
        { label: 'Duplicate', event: 'DUPLICATE', variant: 'secondary' },
        { label: 'Archive', event: 'ARCHIVE', variant: 'danger' },
      ],
    });
    expect(screen.getByTestId('action-EDIT')).toBeInTheDocument();
    expect(screen.getByTestId('action-DUPLICATE')).toBeInTheDocument();
    expect(screen.queryByTestId('action-ARCHIVE')).not.toBeInTheDocument();
    expect(screen.getByTestId('action-overflow')).toBeInTheDocument();
  });

  it('hides the whole action group when showActions is false', () => {
    renderPanel({
      showActions: false,
      actions: [
        { label: 'Edit', event: 'EDIT', variant: 'primary' },
        { label: 'Close', event: 'CLOSE_VIEW', variant: 'ghost' },
      ],
    });
    expect(screen.queryByTestId('action-EDIT')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-CLOSE_VIEW')).not.toBeInTheDocument();
  });
});
