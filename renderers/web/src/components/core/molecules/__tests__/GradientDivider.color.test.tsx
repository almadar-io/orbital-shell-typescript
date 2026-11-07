import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { resolveColorToken } from '../../../../core';
import { GradientDivider } from '../GradientDivider';
import { EdgeDecoration } from '../EdgeDecoration';

describe('G-ORBITAL-SHELL-TYPESCRIPT-074 color token resolution', () => {
  it('maps a palette token to its CSS variable and passes a raw color through', () => {
    expect(resolveColorToken('success')).toBe('var(--color-success)');
    expect(resolveColorToken('#ff0000')).toBe('#ff0000');
  });

  it('control: an inherited object key is not a token', () => {
    expect(resolveColorToken('constructor')).toBe('constructor');
  });

  it('GradientDivider and EdgeDecoration resolve through the same helper', () => {
    const divider = render(<GradientDivider color="error" />);
    expect((divider.container.firstElementChild as HTMLElement).style.background).toContain('var(--color-error)');
    const edge = render(<EdgeDecoration color="error" />);
    expect(edge.container.innerHTML).toContain('var(--color-error)');
  });
});
