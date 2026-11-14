import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { getStdOperatorMeta } from '@almadar/std/registry';
import { AvlEffect } from '../AvlEffect';

function renderEffect(effectType: string): SVGSVGElement {
  const { container } = render(
    <svg>
      <AvlEffect effectType={effectType} x={10} y={20} size={8} />
    </svg>,
  );
  const svg = container.querySelector('svg');
  if (svg === null) throw new Error('svg not rendered');
  return svg;
}

describe('AvlEffect glyph from the std registry', () => {
  it('draws the registry glyph path for an operator that has one', () => {
    const glyph = getStdOperatorMeta('persist')?.visual?.glyph;
    expect(glyph).toBeTruthy();
    const path = renderEffect('persist').querySelector('path');
    expect(path?.getAttribute('d')).toBe(glyph);
    expect(path?.getAttribute('transform')).toBe('translate(10 20) scale(8)');
    expect(path?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  });

  it('control: an operator with no registry glyph still draws its category mark', () => {
    expect(getStdOperatorMeta('navigate-back')?.visual?.glyph).toBeUndefined();
    const svg = renderEffect('navigate-back');
    expect(svg.querySelector('path[vector-effect]')).toBeNull();
    expect(svg.textContent).not.toContain('?');
    expect(svg.querySelector('g > g')).not.toBeNull();
  });
});
