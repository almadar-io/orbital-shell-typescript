import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PatternTile, getTileDimensions, type PatternVariant } from '../PatternTile.js';

function markup(variant: PatternVariant, size: number, color = '#123456', strokeWidth = 1): string {
  return renderToStaticMarkup(<svg><PatternTile variant={variant} size={size} color={color} strokeWidth={strokeWidth} /></svg>);
}

describe('PatternTile shared geometry', () => {
  it('preserves the star8 path and one-pixel stroke at two sizes', () => {
    const at100 = markup('star8', 100);
    const at60 = markup('star8', 60);
    const firstPath = 'M 85.355,85.355 L 67.678,92.678 L 50.000,100.000';
    expect(at100).toContain(firstPath);
    expect(at60).toContain(firstPath);
    expect(at100).toContain('transform="scale(1)"');
    expect(at100).toContain('stroke-width="1"');
    expect(at60).toContain('transform="scale(0.6)"');
    expect(at60).toContain('stroke-width="1.6666666666666667"');
  });

  it('keeps filled dots and opacity in the kolam variant', () => {
    const html = markup('kolam', 100);
    expect((html.match(/<circle /g) ?? []).length).toBe(9);
    expect(html).toContain('fill="#123456" opacity="0.5"');
    expect((html.match(/<path /g) ?? []).length).toBe(36);
  });

  it('preserves the non-square tile dimensions', () => {
    expect(getTileDimensions('star6', 100).height).toBeCloseTo(115.47005383792516);
    expect(getTileDimensions('star6', 60).height).toBeCloseTo(69.2820323027551);
    expect(getTileDimensions('arch', 60)).toEqual({ width: 60, height: 90 });
    expect(getTileDimensions('arabesque-vine', 100)).toEqual({ width: 100, height: 120 });
  });
});
