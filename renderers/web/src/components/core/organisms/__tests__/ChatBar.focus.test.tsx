// @vitest-environment jsdom
/**
 * The conversation is handed to the user through declared props the trait feeds
 * (G-PATTERN-SYNC-041), never an ambient bus subscription: `focusRequest` puts the caret
 * in the input with an optional prompt until the next send; `editFocus` shows the picked
 * canvas element, and its ✕ asks the owner to clear it.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import type { EditFocus } from '@almadar/core';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';
import { ChatBar, type ChatFocusRequest } from '../ChatBar';

let bus: ReturnType<typeof useEventBus> | null = null;
function Grab() {
  bus = useEventBus();
  return null;
}

function bar(props: { focusRequest?: ChatFocusRequest; editFocus?: EditFocus | null }) {
  return (
    <EventBusProvider debug={false}>
      <Grab />
      <ChatBar placeholder="Ask anything" {...props} />
    </EventBusProvider>
  );
}

function input(container: HTMLElement): HTMLTextAreaElement {
  const el = container.querySelector('textarea');
  if (!el) throw new Error('no chat input');
  return el;
}

const button: EditFocus = { level: 'node', orbital: 'Shop', label: 'Buy button' };

describe('ChatBar — focusRequest', () => {
  it('focuses the input and shows the requested prompt', () => {
    const view = render(bar({ focusRequest: { id: 1, placeholder: 'Describe the behavior you want' } }));
    expect(document.activeElement).toBe(input(view.container));
    expect(input(view.container).getAttribute('placeholder')).toBe('Describe the behavior you want');
  });

  it('sending puts the bar placeholder back', () => {
    const view = render(bar({ focusRequest: { id: 1, placeholder: 'Describe the behavior you want' } }));
    act(() => bus?.emit('UI:CHAT_SEND', { message: 'a customer list' }));
    expect(input(view.container).getAttribute('placeholder')).toBe('Ask anything');
  });

  it('the same request re-rendered does not refocus; a new id does', () => {
    const view = render(bar({ focusRequest: { id: 1 } }));
    input(view.container).blur();
    view.rerender(bar({ focusRequest: { id: 1 } }));
    expect(document.activeElement).not.toBe(input(view.container));
    view.rerender(bar({ focusRequest: { id: 2 } }));
    expect(document.activeElement).toBe(input(view.container));
  });

  it('control: nothing focuses the input on its own, and the old bus event no longer does', () => {
    const view = render(bar({}));
    act(() => bus?.emit('UI:CHAT_FOCUS', { placeholder: 'ignored' }));
    expect(document.activeElement).not.toBe(input(view.container));
    expect(input(view.container).getAttribute('placeholder')).toBe('Ask anything');
  });
});

describe('ChatBar — editFocus', () => {
  it('shows the picked element and its ✕ asks the owner to clear it', () => {
    const cleared: Array<EditFocus | null> = [];
    const view = render(bar({ editFocus: button }));
    act(() => { bus?.on('UI:ELEMENT_SELECTED', (e) => cleared.push(e.payload?.focus as EditFocus | null)); });
    expect(view.getByText(/Buy button/)).toBeTruthy();
    fireEvent.click(view.getByTitle(/clear/i));
    expect(cleared).toEqual([null]);
  });

  it('control: no chip without editFocus, and a bus pick no longer shows one', () => {
    const view = render(bar({ editFocus: null }));
    act(() => bus?.emit('UI:ELEMENT_SELECTED', { focus: { level: 'node', orbital: 'Shop', label: 'Buy button' } }));
    expect(view.queryByText(/Buy button/)).toBeNull();
  });
});
