// @vitest-environment jsdom
/**
 * Markdown images may be self-contained (`data:image/...`), so a behavior can
 * carry its own figures. Only an image's src is widened; links and every other
 * URL keep the default safe-protocol filter.
 */
import React from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MarkdownContent } from '../../src/components/core/molecules/markdown/MarkdownContent';

afterEach(cleanup);

const SVG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';

describe('markdown data: images', () => {
  it('keeps a data:image URL on an image src', () => {
    const { container } = render(<MarkdownContent content={`![A diagram](${SVG})`} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(SVG);
  });

  it('control: a data: URL on a link is still dropped', () => {
    const { container } = render(<MarkdownContent content="[open](data:text/html;base64,PGgxPmhpPC9oMT4=)" />);
    expect(container.querySelector('a')?.getAttribute('href') ?? '').toBe('');
  });

  it('edge: a javascript: image src is still dropped', () => {
    const { container } = render(<MarkdownContent content="![x](javascript:alert(1))" />);
    expect(container.querySelector('img')?.getAttribute('src') ?? '').toBe('');
  });

  it('edge: a non-image data: URL on an image is dropped', () => {
    const { container } = render(<MarkdownContent content="![x](data:text/html;base64,PGgxPmhpPC9oMT4=)" />);
    expect(container.querySelector('img')?.getAttribute('src') ?? '').toBe('');
  });

  it('edge: an ordinary https image is unchanged', () => {
    const { container } = render(<MarkdownContent content="![x](https://almadar.io/logo.svg)" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://almadar.io/logo.svg');
  });
});
