// @vitest-environment jsdom
/**
 * useEditorCapabilities — bus-driven editor-capability wiring (Almadar
 * Studio V4 §14 plan, P1 E3). A tiny harness renders a real `<textarea>`
 * and calls the hook against it, so motion/operator math runs through the
 * actual DOM selection APIs, not a mock.
 */
import React, { useEffect, useRef, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { useEventBus, type EventBusContextType } from '../../src/core';
import { useEditorCapabilities, type UseEditorCapabilitiesResult } from '../../src/components/core/molecules/markdown/useEditorCapabilities';
import type { EditorCaret } from '../../src/components/core/molecules/markdown/CodeBlock';

const INITIAL = 'hello world\nfoo bar';
const EVENTS = { onMotion: 'MOTION', onOperate: 'OPERATE', onInsertText: 'INSERT_TEXT', onSetMode: 'SET_MODE' };

// Test-only escape hatch — flips the harness's focus state without adding
// UI just for this. Declared as a real Window augmentation instead of a
// per-use cast.
declare global {
  interface Window {
    __setFocused?: (v: boolean) => void;
  }
}

function Harness({
  editorId,
  applyChange,
  focused,
  apiRef,
}: {
  editorId: string | undefined;
  applyChange: (v: string, origin: 'keystroke' | 'capability') => void;
  focused: boolean;
  apiRef: React.MutableRefObject<UseEditorCapabilitiesResult | null>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const api = useEditorCapabilities({ editorId, textareaRef, events: EVENTS, focused, applyChange });
  apiRef.current = api;
  return <textarea ref={textareaRef} defaultValue={INITIAL} data-testid="ta" data-caret={api.caretMode} />;
}

function Wrapper({
  editorId,
  applyChange,
  apiRef,
}: {
  editorId: string | undefined;
  applyChange: (v: string, origin: 'keystroke' | 'capability') => void;
  apiRef: React.MutableRefObject<UseEditorCapabilitiesResult | null>;
}) {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    // exposed on window so tests can flip focus without adding UI just for this
    window.__setFocused = setFocused;
  }, []);
  return <Harness editorId={editorId} applyChange={applyChange} focused={focused} apiRef={apiRef} />;
}

function renderHarness(editorId: string | undefined) {
  const applyChange = vi.fn();
  const apiRef: React.MutableRefObject<UseEditorCapabilitiesResult | null> = { current: null };
  let bus!: EventBusContextType;
  function BusGrabber() {
    bus = useEventBus();
    return null;
  }
  render(
    <EventBusProvider isolated>
      <BusGrabber />
      <Wrapper editorId={editorId} applyChange={applyChange} apiRef={apiRef} />
    </EventBusProvider>,
  );
  const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
  const setFocused = window.__setFocused;
  if (!setFocused) throw new Error('Wrapper effect did not set window.__setFocused');
  return { applyChange, bus, ta, apiRef, setFocused };
}

function caretModeOf(ta: HTMLTextAreaElement): EditorCaret {
  return ta.dataset.caret as EditorCaret;
}

describe('useEditorCapabilities — motion/operate/insert/set-mode (existing behavior)', () => {
  it('MOTION word-forward moves the caret to the next word start', () => {
    const { bus, ta } = renderHarness('e1');
    ta.setSelectionRange(0, 0);

    act(() => {
      bus.emit('UI:MOTION', { editorId: 'e1', motion: 'word-forward', count: 1 });
    });

    expect(ta.selectionStart).toBe(6);
    expect(ta.selectionEnd).toBe(6);
  });

  it('OPERATE delete word-forward removes the range and calls applyChange with the result', () => {
    const { bus, ta, applyChange } = renderHarness('e1');
    ta.setSelectionRange(0, 0);

    act(() => {
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'delete', motion: 'word-forward', count: 1 });
    });

    expect(ta.value).toBe('world\nfoo bar');
    expect(applyChange).toHaveBeenCalledWith('world\nfoo bar', 'capability');
  });

  it('ignores a payload for a different editorId', () => {
    const { bus, ta, applyChange } = renderHarness('e1');
    ta.setSelectionRange(0, 0);

    act(() => {
      bus.emit('UI:OPERATE', { editorId: 'other', operator: 'delete', motion: 'word-forward', count: 1 });
    });

    expect(ta.value).toBe(INITIAL);
    expect(applyChange).not.toHaveBeenCalled();
  });

  it('SET_MODE updates the returned caretMode while focused', () => {
    const { bus, ta, setFocused } = renderHarness('e1');
    act(() => setFocused(true));
    expect(caretModeOf(ta)).toBe('bar');

    act(() => {
      bus.emit('UI:SET_MODE', { editorId: 'e1', mode: 'INSERT', caret: 'bar' });
    });

    expect(caretModeOf(ta)).toBe('bar');

    act(() => {
      bus.emit('UI:SET_MODE', { editorId: 'e1', mode: 'NORMAL', caret: 'block' });
    });

    expect(caretModeOf(ta)).toBe('block');
  });

  it('INSERT_TEXT inserts at the caret and calls applyChange', () => {
    const { bus, ta, applyChange } = renderHarness('e1');
    ta.setSelectionRange(6, 6);

    act(() => {
      bus.emit('UI:INSERT_TEXT', { editorId: 'e1', text: 'XY' });
    });

    expect(ta.value).toBe('hello XYworld\nfoo bar');
    expect(applyChange).toHaveBeenCalledWith('hello XYworld\nfoo bar', 'capability');
  });

  it('with editorId undefined, no capability event mutates the textarea', () => {
    const { bus, ta, applyChange } = renderHarness(undefined);
    ta.setSelectionRange(0, 0);

    act(() => {
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'delete', motion: 'word-forward', count: 1 });
      bus.emit('UI:MOTION', { editorId: 'e1', motion: 'word-forward', count: 1 });
    });

    expect(ta.value).toBe(INITIAL);
    expect(applyChange).not.toHaveBeenCalled();
  });
});

describe('useEditorCapabilities — closed-vocabulary guard (SV4-1 bug fix)', () => {
  it('rejects an unknown OPERATE operator with a console.warn, leaving the textarea untouched', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bus, ta, applyChange } = renderHarness('e1');
    ta.setSelectionRange(0, 0);

    act(() => {
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'explode', motion: 'word-forward', count: 1 });
    });

    expect(ta.value).toBe(INITIAL);
    expect(applyChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('explode'));
    warn.mockRestore();
  });

  it('rejects an unknown OPERATE motion with a console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bus, ta, applyChange } = renderHarness('e1');

    act(() => {
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'delete', motion: 'teleport', count: 1 });
    });

    expect(ta.value).toBe(INITIAL);
    expect(applyChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('teleport'));
    warn.mockRestore();
  });

  it('rejects an unknown MOTION with a console.warn, leaving the caret untouched', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bus, ta } = renderHarness('e1');
    ta.setSelectionRange(3, 3);

    act(() => {
      bus.emit('UI:MOTION', { editorId: 'e1', motion: 'teleport', count: 1 });
    });

    expect(ta.selectionStart).toBe(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('teleport'));
    warn.mockRestore();
  });
});

describe('useEditorCapabilities — undo/redo history (SV4-1)', () => {
  it('OPERATE undo restores the text and caret from before the last capability edit', () => {
    const { bus, ta, applyChange } = renderHarness('e1');
    ta.setSelectionRange(0, 0);

    act(() => {
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'delete', motion: 'word-forward', count: 1 });
    });
    expect(ta.value).toBe('world\nfoo bar');

    act(() => {
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'undo', motion: 'selection', count: 1 });
    });

    expect(ta.value).toBe(INITIAL);
    expect(ta.selectionStart).toBe(0);
    expect(applyChange).toHaveBeenLastCalledWith(INITIAL, 'capability');
  });

  it('OPERATE redo re-applies an undone edit', () => {
    const { bus, ta } = renderHarness('e1');
    ta.setSelectionRange(0, 0);

    act(() => {
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'delete', motion: 'word-forward', count: 1 });
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'undo', motion: 'selection', count: 1 });
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'redo', motion: 'selection', count: 1 });
    });

    expect(ta.value).toBe('world\nfoo bar');
  });

  it('a count on undo pops that many steps', () => {
    const { bus, ta } = renderHarness('e1');
    ta.setSelectionRange(0, 0);

    act(() => {
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'delete', motion: 'word-forward', count: 1 }); // -> "world\nfoo bar"
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'delete', motion: 'word-forward', count: 1 }); // -> "\nfoo bar"
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'undo', motion: 'selection', count: 2 });
    });

    expect(ta.value).toBe(INITIAL);
  });

  it('undoing past the bottom of the stack is a no-op', () => {
    const { bus, ta, applyChange } = renderHarness('e1');

    act(() => {
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'undo', motion: 'selection', count: 1 });
    });

    expect(ta.value).toBe(INITIAL);
    expect(applyChange).not.toHaveBeenCalled();
  });

  it('a new capability edit after undo clears the redo stack', () => {
    const { bus, ta } = renderHarness('e1');
    ta.setSelectionRange(0, 0);

    act(() => {
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'delete', motion: 'word-forward', count: 1 }); // "world\nfoo bar"
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'undo', motion: 'selection', count: 1 }); // back to INITIAL
      bus.emit('UI:INSERT_TEXT', { editorId: 'e1', text: 'Z' }); // "Zhello world\nfoo bar"
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'redo', motion: 'selection', count: 1 }); // nothing to redo
    });

    expect(ta.value).toBe('Zhello world\nfoo bar');
  });

  it('exposes undo()/redo() directly for the textarea keyboard-shortcut path', () => {
    const { bus, ta, apiRef } = renderHarness('e1');
    ta.setSelectionRange(0, 0);

    act(() => {
      bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'delete', motion: 'word-forward', count: 1 });
    });
    expect(ta.value).toBe('world\nfoo bar');

    act(() => apiRef.current?.undo());
    expect(ta.value).toBe(INITIAL);

    act(() => apiRef.current?.redo());
    expect(ta.value).toBe('world\nfoo bar');
  });
});

describe('useEditorCapabilities — recordKeystroke coalescing rule (SV4-1, all four clauses)', () => {
  // (a) every capability edit is its own step — already covered above (each
  // OPERATE/INSERT_TEXT pushes via pushHistoryStep; undo pops exactly one).

  it('(b) keystrokes coalesce into ONE step for the whole open INSERT-mode session, whitespace included', () => {
    const { bus, ta, apiRef } = renderHarness('e1');

    act(() => {
      bus.emit('UI:SET_MODE', { editorId: 'e1', mode: 'INSERT', caret: 'bar' });
    });

    let text = INITIAL;
    act(() => {
      apiRef.current?.recordKeystroke(text, 0, (text = 'Xhello world\nfoo bar'));
      apiRef.current?.recordKeystroke(text, 1, (text = 'X hello world\nfoo bar')); // whitespace typed
      apiRef.current?.recordKeystroke(text, 2, (text = 'X yhello world\nfoo bar'));
    });
    ta.value = text;

    act(() => apiRef.current?.undo());
    // one coalesced step -> a single undo restores all the way back to INITIAL
    expect(ta.value).toBe(INITIAL);
  });

  it('(c) with no mode session open, keystrokes coalesce until whitespace is typed, then the step closes', () => {
    const { ta, apiRef } = renderHarness('e1');

    let text = INITIAL;
    act(() => {
      apiRef.current?.recordKeystroke(text, 0, (text = 'Xhello world\nfoo bar'));
      apiRef.current?.recordKeystroke(text, 1, (text = 'XYhello world\nfoo bar'));
      apiRef.current?.recordKeystroke(text, 2, (text = 'XY hello world\nfoo bar')); // whitespace -> closes the step
      apiRef.current?.recordKeystroke(text, 3, (text = 'XY Zhello world\nfoo bar')); // starts a NEW step
    });
    ta.value = text;

    act(() => apiRef.current?.undo());
    // undoes only the second (post-whitespace) step
    expect(ta.value).toBe('XY hello world\nfoo bar');

    act(() => apiRef.current?.undo());
    // undoes the first coalesced word-step, back to the original text
    expect(ta.value).toBe(INITIAL);
  });

  it('(d) SET_MODE closes the open typing step, starting a fresh one on the next keystroke', () => {
    const { ta, bus, apiRef } = renderHarness('e1');

    let text = INITIAL;
    act(() => {
      apiRef.current?.recordKeystroke(text, 0, (text = 'Xhello world\nfoo bar'));
      bus.emit('UI:SET_MODE', { editorId: 'e1', mode: 'NORMAL', caret: 'block' }); // closes the step
      apiRef.current?.recordKeystroke(text, 1, (text = 'XYhello world\nfoo bar')); // new step
    });
    ta.value = text;

    act(() => apiRef.current?.undo());
    expect(ta.value).toBe('Xhello world\nfoo bar');

    act(() => apiRef.current?.undo());
    expect(ta.value).toBe(INITIAL);
  });

  it('(d) undo/redo close the open typing step, so a keystroke right after starts a new one', () => {
    const { ta, apiRef } = renderHarness('e1');

    let text = INITIAL;
    act(() => {
      apiRef.current?.recordKeystroke(text, 0, (text = 'Xhello world\nfoo bar'));
    });
    ta.value = text;

    act(() => apiRef.current?.undo());
    expect(ta.value).toBe(INITIAL);

    act(() => apiRef.current?.redo());
    expect(ta.value).toBe('Xhello world\nfoo bar');

    act(() => {
      apiRef.current?.recordKeystroke(ta.value, 1, (text = 'XYhello world\nfoo bar'));
    });
    ta.value = text;

    act(() => apiRef.current?.undo());
    // only the post-redo keystroke is undone -> back to the redo'd state, not further
    expect(ta.value).toBe('Xhello world\nfoo bar');
  });
});

describe('useEditorCapabilities — focus-driven caret reset (SV4-4)', () => {
  it('resets caretMode to bar on the focused->blurred falling edge', () => {
    const { bus, ta, setFocused } = renderHarness('e1');
    act(() => setFocused(true));

    act(() => {
      bus.emit('UI:SET_MODE', { editorId: 'e1', mode: 'NORMAL', caret: 'block' });
    });
    expect(caretModeOf(ta)).toBe('block');

    act(() => setFocused(false));
    expect(caretModeOf(ta)).toBe('bar');
  });
});
