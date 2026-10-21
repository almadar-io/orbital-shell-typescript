import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { VERIFICATION_DOM_ATTRS, FORM_PATTERN, actionTestId } from '@almadar/core';
import { DataGrid, type DataGridField } from '../../molecules/DataGrid';
import { Form } from '../Form';
import { EventBusProvider } from '../../../../core';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('verifier DOM contract owned by @almadar/core', () => {
  it('a DataGrid row with an item action carries the contract attributes and test id', () => {
    const fields: readonly DataGridField[] = [{ name: 'name', variant: 'h4' }];
    const { container } = wrap(
      <DataGrid entity={[{ id: 'r1', name: 'One' }]} fields={fields} itemActions={[{ label: 'Edit', event: 'EDIT', variant: 'primary' }]} />,
    );
    const row = container.querySelector(`[${VERIFICATION_DOM_ATTRS.entityRow}]`);
    expect(row).not.toBeNull();
    expect(row?.getAttribute(VERIFICATION_DOM_ATTRS.entityId)).toBe('r1');
    const button = container.querySelector(`[data-testid="${actionTestId('EDIT')}"]`);
    expect(button?.getAttribute(VERIFICATION_DOM_ATTRS.rowId)).toBe('r1');
  });

  it('a Form carries the form pattern, field names and submit/cancel test ids', () => {
    const { container } = wrap(
      <Form fields={[{ name: 'title', label: 'Title', type: 'string' }]} submitEvent="SAVE" cancelEvent="CLOSE" />,
    );
    expect(container.querySelector(`[${VERIFICATION_DOM_ATTRS.pattern}="${FORM_PATTERN}"]`)).not.toBeNull();
    expect(container.querySelector(`[${VERIFICATION_DOM_ATTRS.fieldName}="title"]`)).not.toBeNull();
    expect(container.querySelector(`[data-testid="${actionTestId('SAVE')}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-testid="${actionTestId('CLOSE')}"]`)).not.toBeNull();
  });
});
