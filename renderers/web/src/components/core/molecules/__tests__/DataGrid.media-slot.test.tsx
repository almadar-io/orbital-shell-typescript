/**
 * Almadar_UX card slot order (media → headline → support → actions): a grid that declares
 * `imageField` gives EVERY card its media slot, so a row without an image keeps the card's
 * shape instead of collapsing into a ragged grid. The empty slot is decorative.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DataGrid, type DataGridField } from '../DataGrid';
import { EventBusProvider } from '../../../../core';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);
const fields: readonly DataGridField[] = [{ name: 'name', variant: 'h4' }];
const rows = [
  { id: 'p1', name: 'Linen Shirt', image: 'https://example.com/shirt.jpg' },
  { id: 'p2', name: 'Stoneware Mug' },
];

describe('DataGrid media slot', () => {
  it('a card whose row has no image keeps a decorative media placeholder', () => {
    const { container } = wrap(<DataGrid entity={rows} fields={fields} imageField="image" cols={3} />);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    const placeholders = container.querySelectorAll('[data-media-placeholder]');
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0].getAttribute('aria-hidden')).toBe('true');
    expect(placeholders[0].className).toContain('aspect-video');
  });

  it('edge: a one-column rows list keeps a small square placeholder', () => {
    const { container } = wrap(<DataGrid entity={rows} fields={fields} imageField="image" cols={1} />);
    expect(container.querySelector('[data-media-placeholder]')?.className).toContain('w-12');
  });

  it('control: a grid without imageField renders no media slot at all', () => {
    const { container } = wrap(<DataGrid entity={rows} fields={fields} cols={3} />);
    expect(container.querySelector('[data-media-placeholder]')).toBeNull();
  });
});
