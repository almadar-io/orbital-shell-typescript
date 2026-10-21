import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { CodeBlock, HIGHLIGHT_CAPACITY_BYTES, PLAIN_CODE_CHUNK_LINES, preloadCodeHighlighter } from '../CodeBlock';

// Blocks paint highlighted only once the on-demand highlighter is in (G-UI-105).
beforeAll(() => preloadCodeHighlighter());
import { EventBusProvider } from '../../../../../core';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <EventBusProvider debug={false}>{children}</EventBusProvider>;
}

const line = (i: number) => `  "field${i}": "${'x'.repeat(40)}",`;
const bigCode = (extra = 0): string => {
  const lines: string[] = [];
  let size = 0;
  for (let i = 0; size <= HIGHLIGHT_CAPACITY_BYTES; i++) { lines.push(line(i)); size += line(i).length + 1; }
  for (let i = 0; i < extra; i++) lines.push(line(-i));
  return lines.join('\n');
};

const chunksOf = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('[data-code-chunk]'));

describe('CodeBlock — over-capacity plain text is laid out in chunks the browser can skip', () => {
  it('standard mode splits the document into fixed-size chunks that together hold every line', () => {
    const code = bigCode(7);
    const { container } = render(<CodeBlock code={code} language="json" />, { wrapper: Wrapper });
    const chunks = chunksOf(container);
    const lineCount = code.split('\n').length;
    expect(chunks).toHaveLength(Math.ceil(lineCount / PLAIN_CODE_CHUNK_LINES));
    expect(chunks.map((c) => c.textContent).join('\n')).toBe(code);
  });

  it('every chunk opts out of offscreen layout and reserves its own line count', () => {
    const code = bigCode();
    const { container } = render(<CodeBlock code={code} language="json" />, { wrapper: Wrapper });
    const [first] = chunksOf(container);
    expect(first.getAttribute('style')).toContain('content-visibility: auto');
    expect(first.getAttribute('style')).toContain(`contain-intrinsic-block-size: auto ${PLAIN_CODE_CHUNK_LINES}lh`);
  });

  it('the chunked document keeps the widest line as its scroll width', () => {
    const code = `${bigCode()}\n${'w'.repeat(500)}`;
    const { container } = render(<CodeBlock code={code} language="json" />, { wrapper: Wrapper });
    expect(chunksOf(container)[0].parentElement?.getAttribute('style')).toContain('min-width: max(100%, 500ch)');
  });

  it('viewer mode chunks its over-capacity text the same way', () => {
    const code = bigCode(3);
    const { container } = render(<CodeBlock code={code} language="json" title="schema.orb" />, { wrapper: Wrapper });
    expect(chunksOf(container).map((c) => c.textContent).join('\n')).toBe(code);
  });

  it('control: code under capacity is highlighted, not chunked', () => {
    const { container } = render(<CodeBlock code={'{\n  "a": 1\n}'} language="json" />, { wrapper: Wrapper });
    expect(chunksOf(container)).toHaveLength(0);
    expect(container.querySelectorAll('[data-line]').length).toBeGreaterThan(0);
  });
});
