/**
 * A badge field's declared `labels` map names its values, in DataList as it
 * already does in DataGrid: a status code reads as the declared word.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataList, type DataListField } from '../DataList';
import { EventBusProvider } from '../../../../core';

const rows = [{ id: '1', name: 'Invoice sent twice', status: 'pending' }];
const wrap = (fields: readonly DataListField[], variant?: 'compact') =>
  render(<EventBusProvider debug={false}><DataList entity={rows} fields={fields} {...(variant ? { variant } : {})} /></EventBusProvider>);

describe('DataList badge labels', () => {
  it('shows the declared label for the value', () => {
    wrap([{ name: 'name', variant: 'h4' }, { name: 'status', variant: 'badge', labels: { pending: 'Waiting' } }]);
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.queryByText('pending')).toBeNull();
  });

  it('shows the declared label in the compact rows too', () => {
    wrap([{ name: 'name', variant: 'h4' }, { name: 'status', variant: 'badge', labels: { pending: 'Waiting' } }], 'compact');
    expect(screen.getByText('Waiting')).toBeTruthy();
  });

  it('control: a value with no declared label shows as written', () => {
    wrap([{ name: 'name', variant: 'h4' }, { name: 'status', variant: 'badge', labels: { active: 'Open' } }]);
    expect(screen.getByText('pending')).toBeTruthy();
  });
});
