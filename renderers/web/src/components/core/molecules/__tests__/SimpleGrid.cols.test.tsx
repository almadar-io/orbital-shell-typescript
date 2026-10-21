/**
 * A three-column grid keeps two columns on tablets (768–1023px) and only goes to
 * three at `lg`, so text cards don't squeeze to ~210px wide.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SimpleGrid } from '../SimpleGrid';

function gridClass(cols: 2 | 3 | 4): string {
  const { container } = render(
    <SimpleGrid cols={cols}>
      <span>a</span>
    </SimpleGrid>,
  );
  return (container.firstElementChild as HTMLElement).className;
}

describe('SimpleGrid column breakpoints', () => {
  it('three columns switch on at lg, not md', () => {
    const cls = gridClass(3);
    expect(cls).toContain('lg:grid-cols-3');
    expect(cls).not.toContain('md:grid-cols-3');
    expect(cls).toContain('sm:grid-cols-2');
  });

  it('control: two columns are unchanged', () => {
    expect(gridClass(2)).toContain('sm:grid-cols-2');
  });

  it('control: four columns still reach four at lg', () => {
    expect(gridClass(4)).toContain('lg:grid-cols-4');
  });
});
