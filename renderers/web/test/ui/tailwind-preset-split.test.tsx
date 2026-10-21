/**
 * Split builds its container-query classes at runtime (`@md:w-1/3`, `@md:flex-row-reverse`),
 * which Tailwind cannot find by scanning, so every one it can emit must be safelisted.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import React from 'react';
import { render } from '@testing-library/react';
import { Split, type SplitRatio } from '../../src/components/core/molecules/Split';

const require = createRequire(import.meta.url);
const preset: { safelist: string[] } = require('../../tailwind-preset.cjs');

const ratios: SplitRatio[] = ['1:1', '1:2', '2:1', '1:3', '3:1', '1:4', '4:1', '2:3', '3:2'];
const breakpoints = ['sm', 'md', 'lg', 'xl'] as const;

function containerClasses(container: HTMLElement): string[] {
  return [...container.querySelectorAll('*')]
    .flatMap((el) => [...el.classList])
    .filter((cls) => cls.startsWith('@') && cls.includes(':'));
}

describe('tailwind preset safelists Split container classes', () => {
  it('every container class Split emits is safelisted', () => {
    const safelist = new Set(preset.safelist);
    const emitted = new Set<string>();
    for (const ratio of ratios) {
      for (const stackBreakpoint of breakpoints) {
        for (const reverse of [false, true]) {
          const { container, unmount } = render(
            <Split ratio={ratio} stackBreakpoint={stackBreakpoint} reverse={reverse}>
              <span>a</span>
              <span>b</span>
            </Split>,
          );
          containerClasses(container).forEach((cls) => emitted.add(cls));
          unmount();
        }
      }
    }
    expect(emitted.has('@md:flex-row-reverse')).toBe(true);
    expect([...emitted].filter((cls) => !safelist.has(cls))).toEqual([]);
  });

  it('control: a split that does not stack reverses without a container query', () => {
    const { container } = render(
      <Split ratio="1:2" stackOnMobile={false} reverse>
        <span>a</span>
        <span>b</span>
      </Split>,
    );
    expect(containerClasses(container)).toEqual([]);
    expect(container.querySelector('.flex-row-reverse')).not.toBeNull();
  });
});
