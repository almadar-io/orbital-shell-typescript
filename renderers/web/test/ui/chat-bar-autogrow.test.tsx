// @vitest-environment jsdom
/**
 * The assistant's input grows with what's typed, up to about six lines, then
 * scrolls; Enter still sends and Shift+Enter still adds a line.
 */
import React from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatBar } from '../../src/components/core/organisms/ChatBar';

afterEach(cleanup);

function textarea(): HTMLTextAreaElement {
  const el = screen.getByRole('textbox');
  if (!(el instanceof HTMLTextAreaElement)) throw new Error('chat input is not a textarea');
  return el;
}

function typeWithHeight(el: HTMLTextAreaElement, value: string, scrollHeight: number): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  fireEvent.change(el, { target: { value } });
}

describe('ChatBar input', () => {
  it('grows to fit what is typed', () => {
    render(<ChatBar placeholder="Ask" sendEvent="ASK" />);
    const el = textarea();
    typeWithHeight(el, 'line one\nline two\nline three', 72);
    expect(el.style.height).toBe('72px');
    expect(el.style.overflowY).toBe('hidden');
  });

  it('control: stops at about six lines and scrolls beyond that', () => {
    render(<ChatBar placeholder="Ask" sendEvent="ASK" />);
    const el = textarea();
    typeWithHeight(el, 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj', 400);
    expect(el.style.height).toBe('160px');
    expect(el.style.overflowY).toBe('auto');
  });
});
