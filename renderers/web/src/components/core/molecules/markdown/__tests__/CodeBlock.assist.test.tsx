/**
 * An editable CodeBlock given an `assist` provider: after a pause it asks for a
 * completion at the caret and shows it as ghost text; on ⌘/Ctrl+. it asks for
 * fixes and lists them. Tab accepts one, ⌘/Ctrl+Enter accepts all, Escape
 * dismisses; typing keeps suggestions true or drops them.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { CodeBlock, type CodeAssistProvider, type CodeAssistRequest, type CodeCompletionProvider } from '../CodeBlock';
import { EventBusProvider } from '../../../../../core';

const CODE = 'state idle {\n  INIT -> idle\n    (set @entity.\n}';
const CARET = CODE.indexOf('(set @entity.') + '(set @entity.'.length;

function setup(provider: CodeAssistProvider, code = CODE, errorLines?: Map<number, 'error' | 'warning'>) {
  const onChange = vi.fn();
  const view = render(
    <EventBusProvider debug={false}>
      <CodeBlock code={code} language="lolo" editable onChange={onChange} assist={provider} errorLines={errorLines} />
    </EventBusProvider>,
  );
  const ta = view.container.querySelector('textarea');
  if (!ta) throw new Error('no textarea');
  return { ...view, ta, onChange };
}

async function pause(ta: HTMLTextAreaElement, caret = CARET) {
  ta.setSelectionRange(caret, caret);
  fireEvent.keyUp(ta, { key: '.' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

function typeInto(ta: HTMLTextAreaElement, next: string, caret: number) {
  fireEvent.change(ta, { target: { value: next } });
  ta.setSelectionRange(caret, caret);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CodeBlock assist', () => {
  it('after a pause it asks for a completion at the caret and shows it as ghost text', async () => {
    vi.useFakeTimers();
    const provider = vi.fn<CodeAssistProvider>().mockResolvedValue({ suggestions: [{ from: CARET, to: CARET, text: 'name ?name)' }] });
    const { ta, getByTestId } = setup(provider);
    await pause(ta);
    const req: CodeAssistRequest = { code: CODE, offset: CARET, kind: 'complete', trigger: 'idle' };
    expect(provider).toHaveBeenCalledWith(req);
    expect(getByTestId('code-assist-ghost').textContent).toBe('name ?name)');
  });

  it('Tab accepts the completion; the caret lands after it', async () => {
    vi.useFakeTimers();
    const { ta, onChange, queryByTestId } = setup(vi.fn<CodeAssistProvider>().mockResolvedValue({ suggestions: [{ from: CARET, to: CARET, text: 'name ?name)' }] }));
    await pause(ta);
    expect(fireEvent.keyDown(ta, { key: 'Tab' })).toBe(false);
    const next = CODE.slice(0, CARET) + 'name ?name)' + CODE.slice(CARET);
    expect(onChange).toHaveBeenLastCalledWith(next);
    expect(ta.selectionStart).toBe(CARET + 'name ?name)'.length);
    expect(queryByTestId('code-assist-ghost')).toBeNull();
  });

  it('typing what the ghost says keeps the rest of it; typing something else drops it', async () => {
    vi.useFakeTimers();
    const { ta, getByTestId, queryByTestId } = setup(vi.fn<CodeAssistProvider>().mockResolvedValue({ suggestions: [{ from: CARET, to: CARET, text: 'name ?name)' }] }));
    await pause(ta);
    typeInto(ta, CODE.slice(0, CARET) + 'na' + CODE.slice(CARET), CARET + 2);
    expect(getByTestId('code-assist-ghost').textContent).toBe('me ?name)');
    typeInto(ta, CODE.slice(0, CARET) + 'nax' + CODE.slice(CARET), CARET + 3);
    expect(queryByTestId('code-assist-ghost')).toBeNull();
  });

  it('⌘/Ctrl+. asks for fixes; Tab applies the next one, ⌘/Ctrl+Enter applies all', async () => {
    vi.useFakeTimers();
    const code = 'aa\nbb\ncc';
    const provider = vi.fn<CodeAssistProvider>().mockResolvedValue({
      suggestions: [{ from: 0, to: 2, text: 'AA', why: 'caps a' }, { from: 6, to: 8, text: 'CC', why: 'caps c' }],
    });
    const { ta, onChange, getByTestId } = setup(provider, code);
    ta.setSelectionRange(4, 4);
    expect(fireEvent.keyDown(ta, { key: '.', metaKey: true })).toBe(false);
    await act(async () => {});
    expect(provider).toHaveBeenCalledWith({ code, offset: 4, kind: 'fix', trigger: 'explicit' });
    expect(getByTestId('code-assist-fix-0').textContent).toContain('caps a');
    fireEvent.keyDown(ta, { key: 'Tab' });
    expect(onChange).toHaveBeenLastCalledWith('AA\nbb\ncc');
    expect(getByTestId('code-assist-fix-0').textContent).toContain('caps c');
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith('AA\nbb\nCC');
  });

  it('accept all applies every fix at once, through the button too', async () => {
    vi.useFakeTimers();
    const code = 'aa\nbb\ncc';
    const { ta, onChange, getByTestId, queryByTestId } = setup(vi.fn<CodeAssistProvider>().mockResolvedValue({
      suggestions: [{ from: 0, to: 2, text: 'AA' }, { from: 6, to: 8, text: 'CC' }],
    }), code);
    fireEvent.keyDown(ta, { key: '.', ctrlKey: true });
    await act(async () => {});
    fireEvent.click(getByTestId('code-assist-accept-all'));
    expect(onChange).toHaveBeenLastCalledWith('AA\nbb\nCC');
    expect(queryByTestId('code-assist-fix-0')).toBeNull();
  });

  it('Escape dismisses; the problems count offers fixes when there are error lines', async () => {
    vi.useFakeTimers();
    const provider = vi.fn<CodeAssistProvider>().mockResolvedValue({ suggestions: [{ from: CARET, to: CARET, text: 'x' }] });
    const { ta, queryByTestId, getByTestId } = setup(provider, CODE, new Map([[3, 'error']]));
    await pause(ta);
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(queryByTestId('code-assist-ghost')).toBeNull();
    fireEvent.click(getByTestId('code-assist-request-fix'));
    await act(async () => {});
    expect(provider).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'fix', trigger: 'explicit' }));
  });

  it('edge: problems without a line (a parse error) still offer fixes through the problems count', () => {
    const provider = vi.fn<CodeAssistProvider>().mockResolvedValue({ suggestions: [] });
    const view = render(
      <EventBusProvider debug={false}>
        <CodeBlock code="x" language="lolo" editable assist={provider} problems={1} />
      </EventBusProvider>,
    );
    expect(view.getByTestId('code-assist-request-fix').textContent).toContain('1');
  });

  it("control: while the language's own list is open a pause asks the model nothing; Ctrl-Space still asks", async () => {
    vi.useFakeTimers();
    const provider = vi.fn<CodeAssistProvider>().mockResolvedValue({ suggestions: [] });
    const completions = vi.fn<CodeCompletionProvider>().mockResolvedValue({ prefix: 'na', candidates: [{ label: 'name' }] });
    const view = render(
      <EventBusProvider debug={false}>
        <CodeBlock code={CODE} language="lolo" editable assist={provider} completions={completions} />
      </EventBusProvider>,
    );
    const ta = view.container.querySelector('textarea');
    if (!ta) throw new Error('no textarea');
    await pause(ta);
    expect(view.getByTestId('code-completions')).toBeTruthy();
    expect(provider).not.toHaveBeenCalled();
    fireEvent.keyDown(ta, { key: ' ', ctrlKey: true });
    await act(async () => {});
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({ kind: 'complete', trigger: 'explicit' }));
  });

  it('edge: on an empty prefix the list is only a menu of statements, so a pause still asks the model', async () => {
    vi.useFakeTimers();
    const provider = vi.fn<CodeAssistProvider>().mockResolvedValue({ suggestions: [] });
    const completions = vi.fn<CodeCompletionProvider>().mockResolvedValue({ prefix: '', candidates: [{ label: 'state' }, { label: 'emits' }] });
    const view = render(
      <EventBusProvider debug={false}>
        <CodeBlock code={CODE} language="lolo" editable assist={provider} completions={completions} />
      </EventBusProvider>,
    );
    const ta = view.container.querySelector('textarea');
    if (!ta) throw new Error('no textarea');
    await pause(ta);
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({ kind: 'complete', trigger: 'idle' }));
  });

  it('edge: an answer for code that has since changed is dropped', async () => {
    vi.useFakeTimers();
    let resolve: (r: { suggestions: { from: number; to: number; text: string }[] }) => void = () => {};
    const provider = vi.fn<CodeAssistProvider>().mockImplementation(() => new Promise((r) => { resolve = r; }));
    const { ta, queryByTestId } = setup(provider);
    await pause(ta);
    typeInto(ta, CODE + ' ', CARET);
    await act(async () => {
      resolve({ suggestions: [{ from: CARET, to: CARET, text: 'STALE' }] });
    });
    expect(queryByTestId('code-assist-ghost')).toBeNull();
  });

  it('control: with no suggestions Tab is left to the browser; without a provider nothing is asked', async () => {
    vi.useFakeTimers();
    const provider = vi.fn<CodeAssistProvider>().mockResolvedValue({ suggestions: [] });
    const { ta } = setup(provider);
    await pause(ta);
    expect(fireEvent.keyDown(ta, { key: 'Tab' })).toBe(true);
    const plain = render(<EventBusProvider debug={false}><CodeBlock code="x" language="lolo" editable /></EventBusProvider>);
    expect(plain.queryByTestId('code-assist-bar')).toBeNull();
  });

  it('edge: a multi-line completion shows its first line at the caret and the rest below it', async () => {
    vi.useFakeTimers();
    const { ta, getByTestId } = setup(vi.fn<CodeAssistProvider>().mockResolvedValue({ suggestions: [{ from: CARET, to: CARET, text: 'name ?name)\n    (notify "ok")' }] }));
    await pause(ta);
    expect(getByTestId('code-assist-ghost').textContent).toBe('name ?name)');
    expect(getByTestId('code-assist-ghost-rest').textContent).toBe('    (notify "ok")');
  });
});
