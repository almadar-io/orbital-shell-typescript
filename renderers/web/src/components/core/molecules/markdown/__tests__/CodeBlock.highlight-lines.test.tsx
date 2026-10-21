// @vitest-environment jsdom
/**
 * highlightLines marks a range of lines (the code of the step a running program just took) and
 * scrolls it to the middle of the block's own scroller. It never moves the page.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { CodeBlock } from '../CodeBlock';

const CODE = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
    const line = this.getAttribute('data-line');
    const top = line !== null ? Number(line) * 20 : 0;
    const height = line !== null ? 20 : 200;
    return { x: 0, left: 0, width: 300, right: 300, top, y: top, height, bottom: top + height, toJSON: () => ({}) };
  });
});
afterEach(() => vi.restoreAllMocks());

const lineEl = (container: HTMLElement, line: number) => container.querySelector<HTMLElement>(`[data-line="${line - 1}"]`);

describe('CodeBlock highlightLines', () => {
  it('marks exactly the range and centres it in the scroller', async () => {
    const { container } = render(<CodeBlock code={CODE} language="lisp" title="door.lolo" highlightLines={{ start: 20, end: 21 }} />);
    await waitFor(() => expect(lineEl(container, 20)?.getAttribute('data-highlighted')).toBe('true'));
    expect(lineEl(container, 21)?.getAttribute('data-highlighted')).toBe('true');
    expect(lineEl(container, 19)?.getAttribute('data-highlighted')).toBeNull();
    expect(lineEl(container, 22)?.getAttribute('data-highlighted')).toBeNull();
    // line 20 sits at y=380 in a 200px scroller: centring the 40px range puts it at 380 + 20 - 100.
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 300 })));
  });

  it('works without a title (the plain block) too', async () => {
    const { container } = render(<CodeBlock code={CODE} language="lisp" highlightLines={{ start: 3, end: 3 }} />);
    await waitFor(() => expect(lineEl(container, 3)?.getAttribute('data-highlighted')).toBe('true'));
  });

  it('control: without highlightLines nothing is marked and nothing scrolls', async () => {
    const { container } = render(<CodeBlock code={CODE} language="lisp" title="door.lolo" />);
    await waitFor(() => expect(lineEl(container, 1)).not.toBeNull());
    expect(container.querySelector('[data-highlighted]')).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
