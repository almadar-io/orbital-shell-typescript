/**
 * A card's title field shows the display label its `labels` map gives the stored value, as badge and body fields do.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DataGrid, type DataGridField } from '../DataGrid';
import { EventBusProvider } from '../../../../core';

const wrap = (fields: readonly DataGridField[], rows: ReadonlyArray<Record<string, string>>) =>
  render(<EventBusProvider debug={false}><DataGrid entity={rows} fields={fields} cols={1} /></EventBusProvider>);

describe('DataGrid title labels', () => {
  it('shows the label of a stored title value', () => {
    const { container } = wrap([{ name: 'role', variant: 'h4', labels: { head_of_department: 'Head of department' } }], [{ id: 'g', role: 'head_of_department' }]);
    expect(container.textContent).toContain('Head of department');
    expect(container.textContent).not.toContain('head_of_department');
  });

  it('control: a title with no labels shows the stored value', () => {
    const { container } = wrap([{ name: 'role', variant: 'h4' }], [{ id: 'g', role: 'owner' }]);
    expect(container.textContent).toContain('owner');
  });

  it('edge: a value the map does not name shows as stored', () => {
    const { container } = wrap([{ name: 'role', variant: 'h4', labels: { owner: 'Owner' } }], [{ id: 'g', role: 'auditor' }]);
    expect(container.textContent).toContain('auditor');
  });
});
