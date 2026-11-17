/**
 * A card's `icon` field draws the item's SVG markup beside its title: as an image, or, when the markup paints in
 * currentColor, as a mask filled with the text colour so a monochrome brand mark follows the theme.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DataGrid, type DataGridField } from '../DataGrid';
import { EventBusProvider } from '../../../../core';

const fields: readonly DataGridField[] = [{ name: 'title', variant: 'h5' }, { name: 'icon', variant: 'icon' }];
const wrap = (rows: ReadonlyArray<Record<string, string>>) =>
  render(<EventBusProvider debug={false}><DataGrid entity={rows} fields={fields} cols={3} /></EventBusProvider>);

describe('DataGrid icon field', () => {
  it('draws a coloured mark as an image and never prints its markup', () => {
    const { container } = wrap([{ id: 'a', title: 'Rust', icon: '<svg viewBox="0 0 1 1"><path fill="#f00"/></svg>' }]);
    const mark = container.querySelector('[data-svg-mark]');
    expect(mark?.getAttribute('data-svg-mark')).toBe('image');
    expect(container.textContent).not.toContain('<svg');
  });

  it('draws a currentColor mark as a mask in the text colour', () => {
    const { container } = wrap([{ id: 'a', title: 'Rust', icon: '<svg viewBox="0 0 1 1"><path fill="currentColor"/></svg>' }]);
    expect(container.querySelector('[data-svg-mark]')?.getAttribute('data-svg-mark')).toBe('tinted');
  });

  it('control: an item without markup draws no mark', () => {
    const { container } = wrap([{ id: 'a', title: 'Rust', icon: '' }]);
    expect(container.querySelector('[data-svg-mark]')).toBeNull();
  });
});
