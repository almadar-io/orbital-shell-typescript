/**
 * A card or row title takes the heading size its field declares (h3 down to h6), so a dense grid can ask for a
 * quieter title than h4; an undeclared or non-heading variant keeps h4.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataGrid, type DataGridField } from '../DataGrid';
import { DataList } from '../DataList';
import { EventBusProvider } from '../../../../core';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);
const rows = [{ id: 'c1', title: 'Thermodynamics' }];
const titleTag = (fields: readonly DataGridField[], list: boolean): string => {
  wrap(list ? <DataList entity={rows} fields={fields} /> : <DataGrid entity={rows} fields={fields} cols={3} />);
  return screen.getByText('Thermodynamics').tagName.toLowerCase();
};

describe('card and row title size', () => {
  it('a grid card title declared h5 renders as h5', () => {
    expect(titleTag([{ name: 'title', variant: 'h5' }], false)).toBe('h5');
  });

  it('a list row title declared h5 renders as h5', () => {
    expect(titleTag([{ name: 'title', variant: 'h5' }], true)).toBe('h5');
  });

  it('control: a grid card title declared h4 stays h4', () => {
    expect(titleTag([{ name: 'title', variant: 'h4' }], false)).toBe('h4');
  });
});
