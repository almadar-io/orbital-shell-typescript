import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Stack } from '../../index';

function stack(align: 'center' | 'stretch') {
  return render(
    <Stack direction="vertical" align={align}>
      <div className="@container w-full" data-testid="cq" />
      <button data-testid="btn">go</button>
    </Stack>,
  );
}

describe('Stack cross-axis centring with full-width children', () => {
  it('a centred vertical stack lets a w-full child stretch while others stay centred', () => {
    const { container } = stack('center');
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('items-center');
    expect(root.className).toContain('[&>.w-full]:self-stretch');
  });

  it('control: a stretched stack needs no override', () => {
    const { container } = stack('stretch');
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('items-stretch');
    expect(root.className).not.toContain('self-stretch');
  });

  it('control: the button child carries no stretch class', () => {
    const { getByTestId } = stack('center');
    expect(getByTestId('btn').className).toBe('');
  });
});
