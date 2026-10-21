// @vitest-environment jsdom
/**
 * A scrolling code or diff area must be reachable by keyboard and named, or a
 * keyboard user cannot scroll it (axe: scrollable-region-focusable).
 */
import React from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CodeBlock } from '../../src/components/core/molecules/markdown/CodeBlock';
import { VersionDiff } from '../../src/components/core/molecules/VersionDiff';

afterEach(cleanup);

const longCode = Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n');
const revisions = [
  { id: 'r1', label: 'v1', content: 'Trips over 500 need approval.' },
  { id: 'r2', label: 'v2', content: 'Trips over 800 need approval.' },
];

describe('scrolling regions are keyboard reachable', () => {
  it('a code block scroller is a named, focusable region (its title names it)', () => {
    render(<CodeBlock code={longCode} language="text" title="deals.lolo" maxHeight="120px" />);
    const region = screen.getByRole('region', { name: 'deals.lolo' });
    expect(region.getAttribute('tabindex')).toBe('0');
  });

  it('edge: an untitled code block still gets a name', () => {
    render(<CodeBlock code={longCode} language="text" maxHeight="120px" />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-label')).toBeTruthy();
    expect(region.getAttribute('tabindex')).toBe('0');
  });

  it('a version diff scroller is a named, focusable region', () => {
    render(<VersionDiff revisions={revisions} beforeId="r1" afterId="r2" view="inline" />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-label')).toBeTruthy();
    expect(region.getAttribute('tabindex')).toBe('0');
  });
});
