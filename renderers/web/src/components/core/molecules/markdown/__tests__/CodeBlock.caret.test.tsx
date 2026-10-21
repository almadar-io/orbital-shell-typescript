/**
 * The editable CodeBlock's modal caret and gutter. The block caret is drawn in
 * the layer that scrolls with the text, follows every MOTION (not only clicks
 * and keys), and in a VISUAL selection sits on the end that moves. The gutter
 * numbers every line and marks the ones with errors.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { CodeBlock } from '../CodeBlock';
import { EventBusProvider } from '../../../../../core';
import { useEventBus, type EventBusContextType } from '../../../../../core';

const CODE = 'one two\nthree four\nfive';

function BusGrabber({ onBus }: { onBus: (bus: EventBusContextType) => void }) {
  onBus(useEventBus());
  return null;
}

function setup(props: Partial<React.ComponentProps<typeof CodeBlock>> = {}) {
  let bus!: EventBusContextType;
  const view = render(
    <EventBusProvider debug={false}>
      <BusGrabber onBus={(b) => { bus = b; }} />
      <CodeBlock code={CODE} language="text" editable editorId="e1" {...props} />
    </EventBusProvider>,
  );
  const ta = view.container.querySelector('textarea');
  if (!ta) throw new Error('no textarea');
  return { ...view, bus, ta };
}

function blockMode(bus: EventBusContextType, ta: HTMLTextAreaElement) {
  fireEvent.focus(ta);
  act(() => {
    bus.emit('UI:SET_MODE', { editorId: 'e1', mode: 'NORMAL', caret: 'block' });
  });
}

/** The caret index the mirror measured to (it holds the text before the caret). */
const mirrored = (container: HTMLElement) => container.querySelector('[data-testid="editor-caret-mirror"]')?.textContent?.replace('​', '') ?? '';

describe('CodeBlock modal caret', () => {
  it('is drawn inside the layer that scrolls with the text', () => {
    const { bus, ta, container, getByTestId } = setup();
    blockMode(bus, ta);
    const overlay = getByTestId('code-editor-overlay');
    expect(overlay.contains(container.querySelector('[data-testid="editor-caret-mirror"]'))).toBe(true);
  });

  it('follows a MOTION even when no click or key event reports it', () => {
    const { bus, ta, container } = setup();
    blockMode(bus, ta);
    ta.setSelectionRange(0, 0);
    act(() => {
      bus.emit('UI:MOTION', { editorId: 'e1', motion: 'word-forward', count: 1 });
    });
    expect(ta.selectionStart).toBe(4);
    expect(mirrored(container)).toBe('one ');
  });

  it('in a VISUAL selection sits on the moving end, and a backward extension keeps the selection', () => {
    const { bus, ta, container } = setup();
    blockMode(bus, ta);
    const three = CODE.indexOf('three');
    ta.setSelectionRange(three, three + 1);
    act(() => {
      bus.emit('UI:MOTION', { editorId: 'e1', motion: 'word-forward', count: 1 });
    });
    const four = CODE.indexOf('four');
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([three, four]);
    expect(mirrored(container)).toBe(CODE.slice(0, four));
    act(() => {
      bus.emit('UI:MOTION', { editorId: 'e1', motion: 'up', count: 1 });
    });
    expect(ta.selectionEnd).toBe(three);
    expect(ta.selectionStart).toBeLessThan(three);
    expect(ta.selectionDirection).toBe('backward');
    expect(mirrored(container)).toBe(CODE.slice(0, ta.selectionStart));
  });

  it('control: a click still places the caret', () => {
    const { bus, ta, container } = setup();
    blockMode(bus, ta);
    ta.setSelectionRange(9, 9);
    fireEvent.click(ta);
    expect(mirrored(container)).toBe(CODE.slice(0, 9));
  });
});

describe('CodeBlock gutter', () => {
  it('numbers every line of the editable code', () => {
    const { getByTestId } = setup();
    expect(getByTestId('code-editor-gutter').textContent).toBe('123');
  });

  it('marks the lines that carry an error', () => {
    const { getByTestId } = setup({ diagnostics: [{ line: 2, column: 1, endColumn: 6, severity: 'error', message: 'm' }] });
    const rows = Array.from(getByTestId('code-editor-gutter').children);
    expect(rows.map((r) => r.getAttribute('data-error'))).toEqual([null, 'true', null]);
  });

  it('control: it can be turned off', () => {
    const { queryByTestId } = setup({ lineNumbers: false });
    expect(queryByTestId('code-editor-gutter')).toBeNull();
  });

  it('edge: typing a new line adds a number', () => {
    const { ta, getByTestId } = setup();
    fireEvent.change(ta, { target: { value: `${CODE}\nsix` } });
    expect(getByTestId('code-editor-gutter').textContent).toBe('1234');
  });
});
