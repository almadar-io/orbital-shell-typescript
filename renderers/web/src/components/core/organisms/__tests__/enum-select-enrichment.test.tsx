/**
 * A `.lolo` string-union entity field (`type : "income" | "expense"`) must
 * render as a `<select>` inside a ModalRecordModal's form-section — not a
 * freeform text input. This reproduces the EXACT render-ui payload the
 * runtime emits for std-finance-tracker's TransactionEdit (form-section
 * nested in a stack, bare string field names, entity = row data), with the
 * entity schema carrying the compiled shape (`type: 'string'` + `values`
 * sidecar) through EntitySchemaProvider.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { SlotContentRenderer } from '../UISlotRenderer';
import { UISlotProvider } from '../../../../providers/UISlotContext';
import { EntitySchemaProvider } from '../../../../providers/EntitySchemaContext';
import type { ResolvedEntity } from '@almadar/core';

const transactionEntity: ResolvedEntity = {
  name: 'Transaction',
  collection: 'transactions',
  fields: [
    { name: 'id', type: 'string', tsType: 'string', required: true, default: undefined, description: undefined, values: undefined, enumValues: undefined, relation: undefined },
    { name: 'description', type: 'string', tsType: 'string', required: true, default: undefined, description: undefined, values: undefined, enumValues: undefined, relation: undefined },
    { name: 'amount', type: 'number', tsType: 'number', required: true, default: undefined, description: undefined, values: undefined, enumValues: undefined, relation: undefined },
    { name: 'type', type: 'string', tsType: 'string', required: false, default: 'expense', description: 'Indicates whether the transaction represents income or an expense.', values: ['income', 'expense'], enumValues: ['income', 'expense'], relation: undefined },
    // description-only field: proves the @description → hint channel
    { name: 'category', type: 'string', tsType: 'string', required: false, default: undefined, description: 'Spending bucket used by budgets and reports.', values: undefined, enumValues: undefined, relation: undefined },
    { name: 'date', type: 'date', tsType: 'string', required: false, default: undefined, description: undefined, values: undefined, enumValues: undefined, relation: undefined },
  ],
  runtime: false,
  shared: undefined,
  hasInstances: false,
  instances: undefined,
  defaults: undefined,
  usedByTraits: [],
  usedByPages: [],
};

// The verbatim modal render-ui payload captured from orbital_play on
// std-finance-tracker (EDIT emit): stack > [hstack, divider, form-section].
const modalContent = {
  id: 'modal-test',
  pattern: 'stack',
  priority: 0,
  sourceTrait: 'TransactionEdit',
  props: {
    direction: 'vertical',
    gap: 'md',
    children: [
      { type: 'divider' },
      {
        mode: 'edit',
        entity: {
          id: 't1', description: 'Coffee beans', amount: 12,
          type: 'expense', date: '2026-08-19T00:00:00.000Z',
        },
        fields: ['description', 'amount', 'type', 'category', 'date'],
        type: 'form-section',
        submitEvent: 'SAVE',
        cancelEvent: 'CLOSE',
      },
    ],
  },
};

function Harness({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <EntitySchemaProvider
      entities={[transactionEntity]}
      traitLinkedEntities={new Map([['TransactionEdit', 'Transaction']])}
      orbitalsByTrait={new Map([['TransactionEdit', 'TransactionOrbital']])}
    >
      <UISlotProvider>{children}</UISlotProvider>
    </EntitySchemaProvider>
  );
}

describe('enum enrichment in a nested form-section (ModalRecordModal shape)', () => {
  it('renders a select with the union options for the `type` field', () => {
    const { container } = render(
      <Harness>
        <SlotContentRenderer content={modalContent} onDismiss={() => {}} />
      </Harness>,
    );

    const selects = Array.from(container.querySelectorAll('select'));
    const typeSelect = selects.find((s) =>
      Array.from(s.querySelectorAll('option')).some((o) => o.value === 'income'),
    );
    expect(typeSelect, 'union-typed field must render a <select> carrying its values').toBeTruthy();
    const optionValues = Array.from(typeSelect!.querySelectorAll('option')).map((o) => o.value);
    expect(optionValues).toContain('income');
    expect(optionValues).toContain('expense');
  });

  it('surfaces the entity field @description as help text under the input', () => {
    const { getByText } = render(
      <Harness>
        <SlotContentRenderer content={modalContent} onDismiss={() => {}} />
      </Harness>,
    );
    expect(getByText('Spending bucket used by budgets and reports.')).toBeTruthy();
    expect(getByText('Indicates whether the transaction represents income or an expense.')).toBeTruthy();
  });

  it('keeps plain string fields as text inputs', () => {
    const { container } = render(
      <Harness>
        <SlotContentRenderer content={modalContent} onDismiss={() => {}} />
      </Harness>,
    );
    const descriptionInput = container.querySelector('input[name="description"], input#description, [data-field="description"] input');
    expect(descriptionInput ?? container.querySelector('input[type="text"]')).toBeTruthy();
  });
});
