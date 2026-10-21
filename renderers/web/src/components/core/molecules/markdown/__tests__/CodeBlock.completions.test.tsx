/**
 * An editable CodeBlock given a `completions` provider asks it for the caret's valid
 * continuations after a keystroke (or on Ctrl-Space) and offers them under the editor;
 * Tab or a click inserts one in place of the typed prefix.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { CodeBlock, applyCompletion, type CodeCompletionProvider, type CodeCompletionResult } from '../CodeBlock';
import { EventBusProvider } from '../../../../../core';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <EventBusProvider debug={false}>{children}</EventBusProvider>;
}

const USES: CodeCompletionResult = {
  prefix: 'us',
  candidates: [{ label: 'uses', detail: 'keyword' }, { label: 'use' }],
};

function setup(provider?: CodeCompletionProvider, code = 'orbital A {\n  us') {
  const onChange = vi.fn();
  const view = render(
    <Wrapper>
      <CodeBlock code={code} language="lolo" editable onChange={onChange} completions={provider} />
    </Wrapper>,
  );
  const ta = view.container.querySelector('textarea');
  if (!ta) throw new Error('no textarea');
  return { ...view, ta, onChange };
}

async function type(ta: HTMLTextAreaElement, key: string, caret = ta.value.length) {
  ta.setSelectionRange(caret, caret);
  fireEvent.keyUp(ta, { key });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CodeBlock completions', () => {
  it('asks the provider at the caret after a keystroke and offers the candidates', async () => {
    vi.useFakeTimers();
    const provider = vi.fn<CodeCompletionProvider>().mockResolvedValue(USES);
    const { ta, getByTestId } = setup(provider);
    await type(ta, 's');
    expect(provider).toHaveBeenCalledWith('orbital A {\n  us', 16);
    expect(getByTestId('code-completions').textContent).toContain('uses');
    expect(getByTestId('code-completion-use')).toBeTruthy();
  });

  it('Tab inserts the first candidate over the typed prefix; the caret lands after it', async () => {
    vi.useFakeTimers();
    const { ta, onChange, queryByTestId } = setup(vi.fn<CodeCompletionProvider>().mockResolvedValue(USES));
    await type(ta, 's');
    const tab = fireEvent.keyDown(ta, { key: 'Tab' });
    expect(tab).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith('orbital A {\n  uses');
    expect(ta.value).toBe('orbital A {\n  uses');
    expect(ta.selectionStart).toBe(18);
    expect(queryByTestId('code-completions')).toBeNull();
  });

  it('an offer never outlives its text: typing on hides it, and Tab cannot insert from it', async () => {
    vi.useFakeTimers();
    const provider = vi.fn<CodeCompletionProvider>()
      .mockResolvedValueOnce(USES)
      .mockReturnValueOnce(new Promise<CodeCompletionResult | null>(() => {}));
    const { ta, onChange, queryByTestId } = setup(provider);
    await type(ta, 's');
    expect(queryByTestId('code-completions')).toBeTruthy();
    fireEvent.change(ta, { target: { value: 'orbital A {\n  usx' } });
    await type(ta, 'x');
    expect(queryByTestId('code-completions')).toBeNull();
    onChange.mockClear();
    const tab = fireEvent.keyDown(ta, { key: 'Tab' });
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining('uses'));
    expect(tab).toBe(true);
  });

  it('a click inserts the chosen candidate', async () => {
    vi.useFakeTimers();
    const { ta, onChange, getByTestId } = setup(vi.fn<CodeCompletionProvider>().mockResolvedValue(USES));
    await type(ta, 's');
    fireEvent.click(getByTestId('code-completion-use'));
    expect(onChange).toHaveBeenLastCalledWith('orbital A {\n  use');
  });

  it('Ctrl-Space asks at once; Escape dismisses', async () => {
    vi.useFakeTimers();
    const provider = vi.fn<CodeCompletionProvider>().mockResolvedValue(USES);
    const { ta, queryByTestId } = setup(provider);
    ta.setSelectionRange(16, 16);
    const space = fireEvent.keyDown(ta, { key: ' ', ctrlKey: true });
    expect(space).toBe(false);
    await act(async () => {});
    expect(provider).toHaveBeenCalledTimes(1);
    expect(queryByTestId('code-completions')).not.toBeNull();
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(queryByTestId('code-completions')).toBeNull();
  });

  it('edge: a slower earlier answer never replaces a newer one', async () => {
    vi.useFakeTimers();
    let resolveFirst: (r: CodeCompletionResult) => void = () => {};
    const provider = vi
      .fn<CodeCompletionProvider>()
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce(USES);
    const { ta, getByTestId, queryByTestId } = setup(provider);
    await type(ta, 'u');
    await type(ta, 's');
    await act(async () => {
      resolveFirst({ prefix: 'u', candidates: [{ label: 'STALE' }] });
    });
    expect(queryByTestId('code-completion-STALE')).toBeNull();
    expect(getByTestId('code-completion-uses')).toBeTruthy();
  });

  it('edge: navigation keys ask nothing; a null or empty answer shows nothing', async () => {
    vi.useFakeTimers();
    const provider = vi.fn<CodeCompletionProvider>().mockResolvedValue(null);
    const { ta, queryByTestId } = setup(provider);
    await type(ta, 'ArrowLeft');
    expect(provider).not.toHaveBeenCalled();
    await type(ta, 's');
    expect(provider).toHaveBeenCalledTimes(1);
    expect(queryByTestId('code-completions')).toBeNull();
  });

  it('control: without a provider Tab is left to the browser and nothing is offered', () => {
    const { ta, queryByTestId } = setup(undefined);
    expect(fireEvent.keyDown(ta, { key: 'Tab' })).toBe(true);
    expect(queryByTestId('code-completions')).toBeNull();
  });

  it('control: Tab with no candidates on offer is left to the browser', async () => {
    vi.useFakeTimers();
    const { ta } = setup(vi.fn<CodeCompletionProvider>().mockResolvedValue({ prefix: '', candidates: [] }));
    await type(ta, 's');
    expect(fireEvent.keyDown(ta, { key: 'Tab' })).toBe(true);
  });
});

describe('CodeBlock completions: the list at the caret', () => {
  it('the selected candidate shows as ghost text; ArrowDown/ArrowUp move the selection and Tab takes it', async () => {
    vi.useFakeTimers();
    const { ta, onChange, getByTestId } = setup(vi.fn<CodeCompletionProvider>().mockResolvedValue(USES));
    await type(ta, 's');
    expect(getByTestId('code-assist-ghost').textContent).toBe('es');
    expect(fireEvent.keyDown(ta, { key: 'ArrowDown' })).toBe(false);
    expect(getByTestId('code-assist-ghost').textContent).toBe('e');
    expect(getByTestId('code-completion-use').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(ta, { key: 'ArrowUp' });
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    fireEvent.keyDown(ta, { key: 'Tab' });
    expect(onChange).toHaveBeenLastCalledWith('orbital A {\n  use');
  });

  it('control: arrows with no list open move the caret as usual', () => {
    const { ta } = setup(undefined);
    expect(fireEvent.keyDown(ta, { key: 'ArrowDown' })).toBe(true);
  });

  it('edge: the selection wraps, and a candidate not extending the prefix shows no ghost', async () => {
    vi.useFakeTimers();
    const { ta, getByTestId, queryByTestId } = setup(vi.fn<CodeCompletionProvider>().mockResolvedValue({ prefix: 'us', candidates: [{ label: 'uses' }, { label: 'orbital' }] }));
    await type(ta, 's');
    fireEvent.keyDown(ta, { key: 'ArrowUp' });
    expect(getByTestId('code-completion-orbital').getAttribute('aria-selected')).toBe('true');
    expect(queryByTestId('code-assist-ghost')).toBeNull();
  });
});

describe('applyCompletion', () => {
  it('replaces the prefix before the offset and puts the caret after the label', () => {
    expect(applyCompletion('a us b', 4, 'us', 'uses')).toEqual({ code: 'a uses b', caret: 6 });
  });
  it('edge: an empty prefix inserts; an offset past the end clamps; UTF-16 offsets', () => {
    expect(applyCompletion('ab', 1, '', 'X')).toEqual({ code: 'aXb', caret: 2 });
    expect(applyCompletion('ab', 9, 'b', 'c')).toEqual({ code: 'ac', caret: 2 });
    expect(applyCompletion('«» us', 5, 'us', 'uses')).toEqual({ code: '«» uses', caret: 7 });
  });
});
