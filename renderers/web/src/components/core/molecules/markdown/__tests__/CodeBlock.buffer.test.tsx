/**
 * CodeBlock buffer mode: the program owns the text and cursor, the surface paints them
 * (caret, selection, decorations, popover, relative gutter) and emits raw input.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { EventPayload } from '@almadar/core';
import { CodeBlock } from '../CodeBlock';
import { EventBusProvider, useEventBus } from '../../../../../core';

type Props = Partial<React.ComponentProps<typeof CodeBlock>>;

function setup(props: Props = {}, listen: string[] = []) {
  const seen: { name: string; payload: EventPayload }[] = [];
  function Spy() {
    const bus = useEventBus();
    React.useEffect(() => {
      const offs = listen.map((name) => bus.on(`UI:${name}`, (e) => { seen.push({ name, payload: e.payload ?? {} }); }));
      return () => offs.forEach((off) => off());
    }, [bus]);
    return null;
  }
  const view = render(
    <EventBusProvider debug={false}>
      <Spy />
      <CodeBlock code={'ab\ncde'} language="text" editorId="e1" {...props} />
    </EventBusProvider>,
  );
  return { ...view, seen };
}

const caretCells = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-caret]'));
const selectedText = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-selected]')).map((n) => n.textContent).join('');

// jsdom has no PointerEvent; a MouseEvent subclass carries the coordinates a browser's would.
class TestPointerEvent extends MouseEvent {}

beforeEach(() => { vi.stubGlobal('PointerEvent', TestPointerEvent); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('CodeBlock buffer mode', () => {
  it('control: without cursor the surface is the classic block (no buffer markup)', () => {
    const { container } = setup({ code: 'ab\ncde' });
    expect(container.querySelector('[data-buffer]')).toBeNull();
    expect(caretCells(container)).toEqual([]);
  });

  it('block caret covers the character at the cursor', () => {
    const { container } = setup({ cursor: { row: 1, col: 2 }, caret: 'block' });
    const cells = caretCells(container);
    expect(cells).toHaveLength(1);
    expect(cells[0].textContent).toBe('e');
    expect(cells[0].getAttribute('data-caret')).toBe('block');
    expect(cells[0].closest('[data-row]')?.getAttribute('data-row')).toBe('1');
  });

  it('bar caret sits before the character; absent caret paints a block', () => {
    const bar = setup({ cursor: { row: 1, col: 2 }, caret: 'bar' });
    const cell = caretCells(bar.container)[0] as HTMLElement;
    expect(cell.getAttribute('data-caret')).toBe('bar');
    expect(cell.textContent).toBe('e');
    expect(cell.style.boxShadow).toContain('inset 2px 0 0');
    bar.unmount();
    const absent = setup({ cursor: { row: 1, col: 2 } });
    expect(caretCells(absent.container)[0].getAttribute('data-caret')).toBe('block');
  });

  it('underline caret underlines the character', () => {
    const { container } = setup({ cursor: { row: 0, col: 0 }, caret: 'underline' });
    const cell = caretCells(container)[0] as HTMLElement;
    expect(cell.textContent).toBe('a');
    expect(cell.style.boxShadow).toContain('inset 0 -2px 0');
  });

  it('a cursor at the line end paints a space-width block after the last character', () => {
    const { container } = setup({ cursor: { row: 0, col: 2 }, caret: 'block' });
    const cells = caretCells(container);
    expect(cells).toHaveLength(1);
    expect(cells[0].textContent).toBe(' ');
    expect(cells[0].previousElementSibling?.textContent).toBe('ab');
  });

  it('linewise selection paints every line from min to max row; control: none without selection', () => {
    const on = setup({ cursor: { row: 0, col: 0 }, selection: { fromRow: 1, fromCol: 1, toRow: 0, toCol: 0, linewise: true } });
    const lines = Array.from(on.container.querySelectorAll('[data-row]'));
    expect(lines.map((l) => l.hasAttribute('data-selected-line'))).toEqual([true, true]);
    expect(selectedText(on.container)).toBe('abcde');
    on.unmount();
    const off = setup({ cursor: { row: 0, col: 0 }, selection: null });
    expect(off.container.querySelectorAll('[data-selected]')).toHaveLength(0);
  });

  it('charwise selection includes the character at the cursor end', () => {
    const { container } = setup({ code: 'abcd', cursor: { row: 0, col: 2 }, selection: { fromRow: 0, fromCol: 1, toRow: 0, toCol: 2, linewise: false } });
    expect(selectedText(container)).toBe('bc');
  });

  it('a keyword decoration colors the text with the keyword token; control: undecorated text is not colored', () => {
    const { container } = setup({
      code: 'fun x',
      cursor: { row: 0, col: 5 },
      decorations: [{ id: 'd1', fromRow: 0, fromCol: 0, toRow: 0, toCol: 3, tone: 'keyword' }],
    });
    const run = container.querySelector('[data-tone="keyword"]') as HTMLElement;
    expect(run.textContent).toBe('fun');
    expect(run.style.color).toBe('var(--color-primary)');
    const rest = Array.from(container.querySelectorAll('[data-row="0"] span')).find((s) => s.textContent === ' x') as HTMLElement;
    expect(rest.style.color).toBe('');
  });

  it('a review decoration paints a background, not a foreground; an unknown tone paints nothing extra', () => {
    const { container } = setup({
      code: 'fun x',
      cursor: { row: 0, col: 5 },
      decorations: [
        { id: 'd1', fromRow: 0, fromCol: 0, toRow: 0, toCol: 3, tone: 'review' },
        { id: 'd2', fromRow: 0, fromCol: 3, toRow: 0, toCol: 4, tone: 'nonsense' },
      ],
    });
    const run = container.querySelector('[data-tone="review"]') as HTMLElement;
    expect(run.textContent).toBe('fun');
    expect(run.style.backgroundColor).not.toBe('');
    expect(run.style.color).toBe('');
    const unknown = container.querySelector('[data-tone="nonsense"]') as HTMLElement;
    expect(unknown.style.backgroundColor).toBe('');
    expect(unknown.style.color).toBe('');
  });

  it('a later decoration paints over an earlier one', () => {
    const { container } = setup({
      code: 'abc',
      cursor: { row: 0, col: 2 },
      decorations: [
        { id: 'a', fromRow: 0, fromCol: 0, toRow: 0, toCol: 3, tone: 'keyword' },
        { id: 'b', fromRow: 0, fromCol: 1, toRow: 0, toCol: 2, tone: 'string' },
      ],
    });
    const mid = Array.from(container.querySelectorAll('[data-tone]')).find((n) => n.textContent === 'b') as HTMLElement;
    expect(mid.style.color).toBe('var(--color-success)');
  });

  it('a decoration spanning rows paints the tail of the first, whole middles and the head of the last', () => {
    const { container } = setup({
      code: 'ab\ncd\nef',
      cursor: { row: 0, col: 0 },
      decorations: [{ id: 'r', fromRow: 0, fromCol: 1, toRow: 2, toCol: 1, tone: 'comment' }],
    });
    const text = Array.from(container.querySelectorAll('[data-tone="comment"]')).map((n) => n.textContent);
    expect(text).toEqual(['b', 'cd', 'e']);
  });

  it('the popover shows its title, section heading and lines; null renders nothing', () => {
    const popover = { fromRow: 0, fromCol: 1, toRow: 0, toCol: 2, title: 'Note', sections: [{ heading: 'Why', lines: ['one', 'two'] }], busy: false };
    const on = setup({ cursor: { row: 0, col: 0 }, popover });
    const pop = on.container.querySelector('[data-popover]') as HTMLElement;
    expect(pop.textContent).toContain('Note');
    expect(pop.textContent).toContain('Why');
    expect(pop.textContent).toContain('one');
    expect(pop.textContent).toContain('two');
    expect(pop.querySelector('[data-busy]')).toBeNull();
    expect(pop.hasAttribute('tabindex')).toBe(false);
    on.unmount();
    const off = setup({ cursor: { row: 0, col: 0 }, popover: null });
    expect(off.container.querySelector('[data-popover]')).toBeNull();
  });

  it('a busy popover shows the progress indicator', () => {
    const popover = { fromRow: 0, fromCol: 0, toRow: 0, toCol: 1, title: 'T', sections: [], busy: true };
    const { container } = setup({ cursor: { row: 0, col: 0 }, popover });
    expect(container.querySelector('[data-popover] [data-busy]')).not.toBeNull();
  });

  it('relative line numbers number by distance from the cursor row, which shows its absolute number', () => {
    const { container } = setup({ code: 'a\nb\nc\nd\ne', cursor: { row: 2, col: 0 }, relativeLineNumbers: true });
    const nums = Array.from(container.querySelectorAll('[data-gutter]')).map((n) => n.textContent);
    expect(nums).toEqual(['2', '1', '3', '1', '2']);
  });

  it('control: without relativeLineNumbers the gutter is absolute', () => {
    const { container } = setup({ code: 'a\nb\nc', cursor: { row: 2, col: 0 } });
    expect(Array.from(container.querySelectorAll('[data-gutter]')).map((n) => n.textContent)).toEqual(['1', '2', '3']);
  });

  it('every keydown emits onKey with the payload and is prevented', () => {
    const { container, seen } = setup({ cursor: { row: 0, col: 0 }, onKey: 'BUF_KEY' }, ['BUF_KEY']);
    const surface = container.querySelector('[data-buffer]') as HTMLElement;
    const notPrevented = fireEvent.keyDown(surface, { key: 'x', code: 'KeyX', ctrlKey: true, shiftKey: true });
    expect(notPrevented).toBe(false);
    expect(seen).toEqual([{ name: 'BUF_KEY', payload: { editorId: 'e1', key: 'x', code: 'KeyX', ctrl: true, alt: false, shift: true, meta: false, repeat: false } }]);
    fireEvent.keyDown(surface, { key: 'Escape', code: 'Escape' });
    expect(seen.map((s) => (s.payload as { key: string }).key)).toEqual(['x', 'Escape']);
  });

  it('an IME composition keydown emits nothing', () => {
    const { container, seen } = setup({ cursor: { row: 0, col: 0 }, onKey: 'BUF_KEY' }, ['BUF_KEY']);
    fireEvent.keyDown(container.querySelector('[data-buffer]') as HTMLElement, { key: 'a', isComposing: true });
    expect(seen).toEqual([]);
  });

  it('a press on a character cell emits onPointerDown with its row and column, and focuses the surface', () => {
    const rect = (width: number): DOMRect => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-probe') ? rect(100) : rect(0);
    });
    const { container, seen } = setup({ cursor: { row: 0, col: 0 }, onPointerDown: 'BUF_DOWN', onHover: 'BUF_HOVER' }, ['BUF_DOWN', 'BUF_HOVER']);
    const surface = container.querySelector('[data-buffer]') as HTMLElement;
    const line1 = container.querySelector('[data-row="1"]') as HTMLElement;
    fireEvent.pointerDown(line1, { clientX: 15, clientY: 0 });
    expect(seen).toEqual([{ name: 'BUF_DOWN', payload: { editorId: 'e1', row: 1, col: 1 } }]);
    expect(document.activeElement).toBe(surface);
  });

  it('a press past the line end gives the line length; the same cell twice hovers once', () => {
    const rect = (width: number): DOMRect => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-probe') ? rect(100) : rect(0);
    });
    const { container, seen } = setup({ cursor: { row: 0, col: 0 }, onPointerDown: 'BUF_DOWN', onHover: 'BUF_HOVER' }, ['BUF_DOWN', 'BUF_HOVER']);
    const line0 = container.querySelector('[data-row="0"]') as HTMLElement;
    fireEvent.pointerDown(line0, { clientX: 95, clientY: 0 });
    expect(seen[0].payload).toEqual({ editorId: 'e1', row: 0, col: 2 });
    seen.length = 0;
    fireEvent.pointerMove(line0, { clientX: 5, clientY: 0 });
    fireEvent.pointerMove(line0, { clientX: 7, clientY: 0 });
    fireEvent.pointerMove(line0, { clientX: 15, clientY: 0 });
    expect(seen.map((s) => s.payload)).toEqual([{ editorId: 'e1', row: 0, col: 0 }, { editorId: 'e1', row: 0, col: 1 }]);
  });

  it('the cursor line is scrolled into view when the cursor moves', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
    const lines = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const view = render(
      <EventBusProvider debug={false}>
        <CodeBlock code={lines} language="text" editorId="e1" cursor={{ row: 0, col: 0 }} />
      </EventBusProvider>,
    );
    const scroller = view.container.querySelector('[data-buffer-scroll]') as HTMLElement;
    expect(scroller.scrollTop).toBe(0);
    view.rerender(
      <EventBusProvider debug={false}>
        <CodeBlock code={lines} language="text" editorId="e1" cursor={{ row: 10, col: 0 }} />
      </EventBusProvider>,
    );
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });

  it('focus and blur emit the editor focus events', () => {
    const { container, seen } = setup({ cursor: { row: 0, col: 0 } }, ['EDITOR_FOCUS', 'EDITOR_BLUR']);
    const surface = container.querySelector('[data-buffer]') as HTMLElement;
    fireEvent.focus(surface);
    fireEvent.blur(surface);
    expect(seen).toEqual([
      { name: 'EDITOR_FOCUS', payload: { editorId: 'e1' } },
      { name: 'EDITOR_BLUR', payload: { editorId: 'e1' } },
    ]);
  });
});
