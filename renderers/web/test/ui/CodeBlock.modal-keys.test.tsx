// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import type { EventPayload } from '@almadar/core';
import { CodeBlock } from '../../src/components/core/molecules/markdown/CodeBlock';
import { EventBusProvider } from '../../src/core';
import { useEventBus } from '../../src/core';
import type { EventBusContextType } from '../../src/core';

function renderEditor(onKey: string | undefined) {
  let bus!: EventBusContextType;
  const keys: EventPayload[] = [];
  function BusGrabber() {
    bus = useEventBus();
    React.useEffect(() => bus.on('UI:SHELL_KEY', (e) => { keys.push(e.payload ?? {}); }), []);
    return null;
  }
  const { container } = render(
    <EventBusProvider debug={false}>
      <BusGrabber />
      <CodeBlock code="alpha" language="text" editable editorId="e1" onChange={() => {}} {...(onKey ? { onKey } : {})} />
    </EventBusProvider>,
  );
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  const setMode = (payload: EventPayload) => act(() => { bus.emit('UI:SET_MODE', payload); });
  // fireEvent returns false when the handler called preventDefault.
  const press = (key: string, extra: Partial<KeyboardEventInit> = {}) => !fireEvent.keyDown(textarea, { key, code: `Key${key.toUpperCase()}`, ...extra });
  return { keys, setMode, press };
}

describe('CodeBlock onKey — keys a modal plugin declares, captured per mode', () => {
  it('after SET_MODE lists keys, a listed key is prevented and emitted with the editor id', () => {
    const { keys, setMode, press } = renderEditor('SHELL_KEY');
    setMode({ editorId: 'e1', mode: 'NORMAL', caret: 'block', keys: ['i', 'Escape'] });
    expect(press('i')).toBe(true);
    expect(keys).toEqual([{ editorId: 'e1', key: 'i', code: 'KeyI', ctrl: false, alt: false, shift: false, meta: false, repeat: false }]);
  });

  it('a key the mode does not list types normally and emits nothing', () => {
    const { keys, setMode, press } = renderEditor('SHELL_KEY');
    setMode({ editorId: 'e1', mode: 'NORMAL', caret: 'block', keys: ['i'] });
    expect(press('x')).toBe(false);
    expect(keys).toEqual([]);
  });

  it('a later SET_MODE replaces the list (INSERT keeps only Escape)', () => {
    const { keys, setMode, press } = renderEditor('SHELL_KEY');
    setMode({ editorId: 'e1', mode: 'NORMAL', caret: 'block', keys: ['i', 'Escape'] });
    setMode({ editorId: 'e1', mode: 'INSERT', caret: 'bar', keys: ['Escape'] });
    expect(press('i')).toBe(false);
    expect(press('Escape')).toBe(true);
    expect(keys.map((k) => k.key)).toEqual(['Escape']);
  });

  it('a chord is captured only when listed in the router spelling', () => {
    const { keys, setMode, press } = renderEditor('SHELL_KEY');
    setMode({ editorId: 'e1', mode: 'NORMAL', caret: 'block', keys: ['Control+r'] });
    expect(press('r')).toBe(false);
    expect(press('r', { ctrlKey: true })).toBe(true);
    expect(keys.map((k) => k.ctrl)).toEqual([true]);
  });

  it('control: before any SET_MODE nothing is captured', () => {
    const { keys, press } = renderEditor('SHELL_KEY');
    expect(press('i')).toBe(false);
    expect(keys).toEqual([]);
  });

  it('control: a SET_MODE for another editor changes nothing here', () => {
    const { keys, setMode, press } = renderEditor('SHELL_KEY');
    setMode({ editorId: 'other', mode: 'NORMAL', caret: 'block', keys: ['i'] });
    expect(press('i')).toBe(false);
    expect(keys).toEqual([]);
  });

  it('control: without onKey the editor never captures, even when a mode lists keys', () => {
    const { keys, setMode, press } = renderEditor(undefined);
    setMode({ editorId: 'e1', mode: 'NORMAL', caret: 'block', keys: ['i'] });
    expect(press('i')).toBe(false);
    expect(keys).toEqual([]);
  });

  it('edge: a SET_MODE without keys keeps the caret contract and captures nothing', () => {
    const { keys, setMode, press } = renderEditor('SHELL_KEY');
    setMode({ editorId: 'e1', mode: 'NORMAL', caret: 'block' });
    expect(press('i')).toBe(false);
    expect(keys).toEqual([]);
  });
});
