/**
 * RED BY DESIGN (H1, G-ORBITAL-SHELL-TYPESCRIPT-108): the host holds no row ordering. `it.fails` passes while
 * `sortRows` is still exported and fails when it is deleted.
 */
import { describe, it, expect } from 'vitest';
import * as format from '../format';

describe('G-ORBITAL-SHELL-TYPESCRIPT-108 red: format.ts has no row ordering', () => {
  it.fails('exports no sortRows and no compareCellValues', () => {
    expect('sortRows' in format).toBe(false);
    expect('compareCellValues' in format).toBe(false);
  });
});
