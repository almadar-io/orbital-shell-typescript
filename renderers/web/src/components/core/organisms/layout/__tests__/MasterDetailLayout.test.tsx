import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MasterDetailLayout } from '../MasterDetailLayout';

describe('MasterDetailLayout', () => {
  it('splits by its own container width, not the viewport', () => {
    const { container } = render(<MasterDetailLayout master={<p>List</p>} detail={<p>Record</p>} hasSelection />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('@container');
    const grid = root.firstElementChild as HTMLElement;
    expect(grid.className).toContain('@md:grid');
    expect(grid.className).not.toMatch(/(^|\s)md:grid/);
  });

  it('with a selection on a narrow container, the list hides and the record shows', () => {
    render(<MasterDetailLayout master={<p>List</p>} detail={<p>Record</p>} hasSelection />);
    expect(screen.getByText('List').parentElement?.className).toContain('hidden @md:block');
    expect(screen.getByText('Record').parentElement?.className).not.toContain('hidden');
  });

  it('control: without a selection the list shows and the detail hides', () => {
    render(<MasterDetailLayout master={<p>List</p>} detail={<p>Record</p>} emptyDetail={<p>Pick one</p>} />);
    expect(screen.getByText('List').parentElement?.className).not.toContain('hidden');
    expect(screen.getByText('Pick one').parentElement?.className).toContain('hidden @md:block');
  });
});
