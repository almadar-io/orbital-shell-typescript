// @vitest-environment jsdom
/**
 * A focus request with text puts it in the input for the user to edit; a new id
 * puts the next text; the same id re-rendered leaves what the user typed alone.
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

describe('ChatBar focus request', () => {
  it('fills the input with the requested text and focuses it', () => {
    render(<ChatBar sendEvent="ASK" focusRequest={{ id: 1, text: 'Preveri dostopnost https://' }} />);
    expect(textarea().value).toBe('Preveri dostopnost https://');
    expect(document.activeElement).toBe(textarea());
  });

  it('a new id replaces the input with the new text', () => {
    const { rerender } = render(<ChatBar sendEvent="ASK" focusRequest={{ id: 1, text: 'first' }} />);
    rerender(<ChatBar sendEvent="ASK" focusRequest={{ id: 2, text: 'second' }} />);
    expect(textarea().value).toBe('second');
  });

  it('edge: the same request re-rendered keeps what the user typed', () => {
    const { rerender } = render(<ChatBar sendEvent="ASK" focusRequest={{ id: 1, text: 'template' }} />);
    fireEvent.change(textarea(), { target: { value: 'template edited' } });
    rerender(<ChatBar sendEvent="ASK" focusRequest={{ id: 1, text: 'template' }} />);
    expect(textarea().value).toBe('template edited');
  });

  it('control: a request without text focuses and leaves the input as it is', () => {
    const { rerender } = render(<ChatBar sendEvent="ASK" />);
    fireEvent.change(textarea(), { target: { value: 'typed' } });
    rerender(<ChatBar sendEvent="ASK" focusRequest={{ id: 1, placeholder: 'Ask about it' }} />);
    expect(textarea().value).toBe('typed');
  });
});
