// @vitest-environment jsdom
/**
 * Tailwind generates only the classes it can read in the source, so every responsive column
 * class Grid can put on the page must be written out literally — a class built from a template
 * string never reaches the CSS and the layout silently stays one column.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Grid } from '../Grid';

const SOURCE = readFileSync(path.join(__dirname, '..', 'Grid.tsx'), 'utf8');
const COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const BREAKPOINTS = ['sm', 'md', 'lg', 'xl'] as const;

describe('Grid responsive columns', () => {
  it('every responsive class it emits is written out in its source', () => {
    for (const bp of BREAKPOINTS) {
      for (const n of COLS) {
        const { container, unmount } = render(<Grid cols={{ base: 1, [bp]: n }}><span /></Grid>);
        const classes = (container.firstElementChild?.className ?? '').split(/\s+/);
        const responsive = classes.filter((c) => c.startsWith(`${bp}:`));
        expect(responsive).toEqual([`${bp}:grid-cols-${n}`]);
        expect(SOURCE).toContain(`'${bp}:grid-cols-${n}'`);
        unmount();
      }
    }
  });

  it('control: a plain column count is unchanged', () => {
    const { container } = render(<Grid cols={3}><span /></Grid>);
    expect(container.firstElementChild?.className).toContain('grid-cols-3');
  });
});
