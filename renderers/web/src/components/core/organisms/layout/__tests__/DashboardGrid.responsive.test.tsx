import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DashboardGrid, type DashboardGridProps } from '../DashboardGrid';

function grid(props: Partial<DashboardGridProps>) {
  const { container } = render(<DashboardGrid cells={[{ id: 'a', content: 'A' }]} {...props} />);
  const root = container.firstElementChild as HTMLElement;
  return { root, cells: [...root.children] as HTMLElement[] };
}

const classes = (el: HTMLElement) => el.className.split(/\s+/);

describe('DashboardGrid responsiveness', () => {
  it.each([2, 3, 4] as const)('a %i-column grid starts at one column on a phone', (columns) => {
    const { root } = grid({ columns });
    expect(classes(root)).toContain('grid-cols-1');
    expect(classes(root)).not.toContain(`grid-cols-${columns}`);
    expect(root.className).toContain(`:grid-cols-${columns}`);
  });

  it('collapses a wide cell to one column on a phone', () => {
    const { cells } = grid({ columns: 4, cells: [{ id: 'w', content: 'W', colSpan: 2 }] });
    expect(classes(cells[0])).toContain('col-span-1');
    expect(cells[0].className).toContain('sm:col-span-2');
  });

  it('clamps a span wider than the grid, so it never creates an implicit column', () => {
    const { cells } = grid({ columns: 2, cells: [{ id: 'w', content: 'W', colSpan: 4 }] });
    expect(cells[0].className).not.toMatch(/col-span-[34]/);
    expect(cells[0].className).toContain('sm:col-span-2');
  });

  it('follows the container, not only the viewport', () => {
    const { root } = grid({ columns: 3 });
    expect(root.className).toContain('@max-sm:!grid-cols-1');
  });

  it('pads its cells', () => {
    const { cells } = grid({});
    expect(cells[0].className).toMatch(/\bp-\d/);
  });

  it('control: a one-column span stays one column at every width', () => {
    const { cells } = grid({ columns: 4, cells: [{ id: 'n', content: 'N', colSpan: 1 }] });
    expect(cells[0].className).not.toMatch(/col-span-[234]/);
  });
});
