// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SimpleGrid } from '../SimpleGrid';

function gridOf(node: React.ReactElement): HTMLElement {
  const { container } = render(node);
  return container.firstElementChild as HTMLElement;
}

describe('SimpleGrid maxCols', () => {
  it('caps the column count in the track, not the grid width (the grid still fills its container)', () => {
    const el = gridOf(<SimpleGrid minChildWidth="200px" maxCols={3} gap="md"><span>a</span></SimpleGrid>);
    expect(el.style.maxWidth).toBe('');
    expect(el.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(max(min(200px, 100%), calc((100% - 2 * 1rem) / 3)), 1fr))');
  });

  it('the cap uses the declared gap size', () => {
    const el = gridOf(<SimpleGrid minChildWidth={150} maxCols={2} gap="lg"><span>a</span></SimpleGrid>);
    expect(el.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(max(min(150px, 100%), calc((100% - 1 * 1.5rem) / 2)), 1fr))');
  });

  it('control: without maxCols the track is plain auto-fit', () => {
    const el = gridOf(<SimpleGrid minChildWidth="200px"><span>a</span></SimpleGrid>);
    expect(el.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(200px, 1fr))');
  });

  it('forwards data-*, aria-* and role like the other layout primitives', () => {
    const el = gridOf(<SimpleGrid data-testid="g" aria-label="Figures" role="list"><span>a</span></SimpleGrid>);
    expect(el.getAttribute('data-testid')).toBe('g');
    expect(el.getAttribute('aria-label')).toBe('Figures');
    expect(el.getAttribute('role')).toBe('list');
  });

  it('forwards them on the fixed-cols branch too', () => {
    const el = gridOf(<SimpleGrid cols={2} data-testid="fixed"><span>a</span></SimpleGrid>);
    expect(el.getAttribute('data-testid')).toBe('fixed');
  });
});
