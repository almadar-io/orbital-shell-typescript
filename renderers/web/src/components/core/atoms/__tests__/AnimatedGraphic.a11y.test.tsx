import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnimatedGraphic } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const ILLUSTRATION = "<svg class='s1' viewBox='0 0 10 10' xmlns='http://www.w3.org/2000/svg' role='img'><rect width='10' height='10'/></svg>";

describe('AnimatedGraphic a11y', () => {
  it('an inline illustration whose svg declares role=img passes axe without alt (decorative)', async () => {
    const { container } = render(<AnimatedGraphic svgContent={ILLUSTRATION} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('with alt the graphic is one named image and its inner svg is presentational', async () => {
    const { container } = render(<AnimatedGraphic svgContent={ILLUSTRATION} alt="A storefront" />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'A storefront' })).toBeTruthy();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: children (no svg) stay exposed', () => {
    render(<AnimatedGraphic><span>caption</span></AnimatedGraphic>);
    expect(screen.getByText('caption')).toBeTruthy();
  });
});
