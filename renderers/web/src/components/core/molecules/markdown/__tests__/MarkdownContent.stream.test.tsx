/**
 * Streamed markdown (an LLM reply growing chunk by chunk) re-renders with longer content each time: the blocks that
 * were already there keep their DOM, so a reader scrolled into them is not moved by a code block remounting.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownContent } from '../MarkdownContent';

const start = 'Intro.\n\n```rust\nlet x = 1;\n```\n\nSee [the book](https://doc.rust-lang.org/book/) and `x`.\n';

describe('MarkdownContent streaming', () => {
  it('keeps an earlier code block, link and inline code mounted when more text arrives', () => {
    const { container, rerender } = render(<MarkdownContent content={start} />);
    const block = container.querySelector('.prose > div');
    const link = container.querySelector('a');
    const inline = container.querySelector('p code');
    expect(block).not.toBeNull();
    rerender(<MarkdownContent content={`${start}\nMore text arrives`} />);
    expect(container.querySelector('.prose > div')).toBe(block);
    expect(container.querySelector('a')).toBe(link);
    expect(container.querySelector('p code')).toBe(inline);
  });

  it('control: a changed code block shows its new code', () => {
    const { container, rerender } = render(<MarkdownContent content={start} />);
    rerender(<MarkdownContent content={start.replace('let x = 1;', 'let y = 2;')} />);
    expect(container.textContent).toContain('let y = 2;');
    expect(container.textContent).not.toContain('let x = 1;');
  });
});
