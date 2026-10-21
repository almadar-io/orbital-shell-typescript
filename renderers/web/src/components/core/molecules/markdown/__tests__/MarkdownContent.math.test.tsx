import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MarkdownContent } from '../MarkdownContent';

describe('MarkdownContent math', () => {
  it('typesets a math expression once the math renderer loads', async () => {
    const { container } = render(<MarkdownContent content={'Energy is $E = mc^2$ here.'} />);
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
  });

  it('typesets display math', async () => {
    const { container } = render(<MarkdownContent content={'$$\n\\int_0^1 x\\,dx\n$$'} />);
    await waitFor(() => expect(container.querySelector('.katex-display')).not.toBeNull());
  });

  it('control: plain markdown renders at once and never loads the math renderer', async () => {
    const { container } = render(<MarkdownContent content={'# Title\n\nJust **bold** text, price is 5 dollars.'} />);
    expect(container.querySelector('h1')?.textContent).toBe('Title');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });
});
