'use client';
/**
 * useEditorCapabilities — colocated with `CodeBlock.tsx`.
 *
 * Wires the four declarative editor-capability LISTENS (`onMotion` /
 * `onOperate` / `onInsertText` / `onSetMode`, Almadar Studio V4 §14 plan,
 * P1 E3) onto a live `<textarea>` via the pure `editorMotions` module. Not
 * barrel-exported — internal to the `CodeBlock` editable branch.
 *
 * Undo/redo history (SV4-1): `past`/`future` stacks of `{text, caret}`
 * snapshots. Coalescing rule (deterministic):
 *   (a) every capability edit (OPERATE, INSERT_TEXT) is its own step.
 *   (b) keystroke edits coalesce into one open "typing step" while an
 *       INSERT-mode session is open (a SET_MODE whose `mode` is `'INSERT'`
 *       opens it; any other SET_MODE closes it).
 *   (c) when no mode session is open, consecutive keystroke edits coalesce
 *       until the typed delta contains whitespace/newline, which closes
 *       the step (word-level undo).
 *   (d) undo, redo, and every SET_MODE close the currently open typing step.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { type BusEvent } from '@almadar/core';
import { useEventListener } from '../../../../core';
import type { EventPayload } from '@almadar/core';
import {
  applyMotion,
  motionRange,
  applyOperator,
  isEditorMotion,
  isEditorOperator,
  type EditorMotion,
  type EditorOperator,
} from '../../../../lib/editorMotions';
import type { EditorCaret } from './CodeBlock';

export interface EditorCapabilityEvents {
  onMotion: string;
  onOperate: string;
  onInsertText: string;
  onSetMode: string;
}

export interface UseEditorCapabilitiesArgs {
  /** Unset = this instance never receives capability events. */
  editorId: string | undefined;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  events: EditorCapabilityEvents;
  /** The caret's new index after a MOTION/OPERATE moved it (the selection's moving end). */
  onCaret?: (index: number) => void;
  /** Whether the textarea is currently focused — the block/underline caret only ever renders while true; the falling edge resets `caretMode` to `'bar'`. */
  focused: boolean;
  /** The ONE change path — same one a keystroke drives. `origin` distinguishes a keystroke (subject to undo coalescing) from a capability edit (always its own history step). */
  applyChange: (next: string, origin: 'keystroke' | 'capability') => void;
}

export interface MotionPayload extends EventPayload {
  editorId: string;
  motion: EditorMotion;
  count: number;
}

export interface OperatePayload extends EventPayload {
  editorId: string;
  operator: EditorOperator;
  motion: EditorMotion;
  count: number;
}

export interface InsertTextPayload extends EventPayload {
  editorId: string;
  text: string;
}

export interface SetModePayload extends EventPayload {
  editorId: string;
  mode: string;
  caret: EditorCaret;
  /** The keys the mode captures, in `useKeyboardRouter`'s spelling (bare key or `Control+Alt+Shift+Meta` chord). */
  keys?: string[];
}

interface HistorySnapshot {
  text: string;
  caret: number;
}

function isMotionPayload(payload: EventPayload | undefined): payload is MotionPayload {
  return (
    !!payload &&
    typeof payload.editorId === 'string' &&
    typeof payload.motion === 'string' &&
    typeof payload.count === 'number'
  );
}

function isOperatePayload(payload: EventPayload | undefined): payload is OperatePayload {
  return (
    !!payload &&
    typeof payload.editorId === 'string' &&
    typeof payload.operator === 'string' &&
    typeof payload.motion === 'string' &&
    typeof payload.count === 'number'
  );
}

function isInsertTextPayload(payload: EventPayload | undefined): payload is InsertTextPayload {
  return !!payload && typeof payload.editorId === 'string' && typeof payload.text === 'string';
}

function isSetModePayload(payload: EventPayload | undefined): payload is SetModePayload {
  return (
    !!payload &&
    typeof payload.editorId === 'string' &&
    typeof payload.mode === 'string' &&
    typeof payload.caret === 'string'
  );
}

/** Common prefix/suffix trim of `prev`/`next` -> the substring that actually changed (deleted content + inserted content concatenated). */
function typedDelta(prev: string, next: string): string {
  const maxPrefix = Math.min(prev.length, next.length);
  let prefixLen = 0;
  while (prefixLen < maxPrefix && prev[prefixLen] === next[prefixLen]) prefixLen++;
  const maxSuffix = Math.min(prev.length - prefixLen, next.length - prefixLen);
  let suffixLen = 0;
  while (
    suffixLen < maxSuffix &&
    prev[prev.length - 1 - suffixLen] === next[next.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }
  const removed = prev.slice(prefixLen, prev.length - suffixLen);
  const inserted = next.slice(prefixLen, next.length - suffixLen);
  return removed + inserted;
}

export interface UseEditorCapabilitiesResult {
  caretMode: EditorCaret;
  /** Called by CodeBlock's textarea `onChange` for every keystroke-driven edit, BEFORE `applyChange` — feeds the undo coalescing rule. */
  recordKeystroke: (prevText: string, prevCaret: number, nextText: string) => void;
  undo: () => void;
  redo: () => void;
  /** The keys the latest SET_MODE for this editor declared; empty until one does. */
  capturedKeys: ReadonlySet<string>;
}

const NO_KEYS: ReadonlySet<string> = new Set();

export function useEditorCapabilities(args: UseEditorCapabilitiesArgs): UseEditorCapabilitiesResult {
  const [caretMode, setCaretMode] = useState<EditorCaret>('bar');
  const [capturedKeys, setCapturedKeys] = useState<ReadonlySet<string>>(NO_KEYS);
  // Vim-style yank/delete register. Unnamed — the single register the
  // vocabulary currently exposes. `registerLinewise` records whether the
  // yank/delete that filled it used the `line` motion (drives `put`).
  const registerRef = useRef<string>('');
  const registerLinewiseRef = useRef<boolean>(false);

  // Undo/redo history — see the coalescing rule in the module doc comment.
  const pastRef = useRef<HistorySnapshot[]>([]);
  const futureRef = useRef<HistorySnapshot[]>([]);
  const openTypingStepRef = useRef<boolean>(false);
  const insertSessionOpenRef = useRef<boolean>(false);

  const closeOpenTypingStep = useCallback(() => {
    openTypingStepRef.current = false;
  }, []);

  const pushHistoryStep = useCallback(
    (text: string, caret: number) => {
      closeOpenTypingStep();
      pastRef.current.push({ text, caret });
      futureRef.current = [];
    },
    [closeOpenTypingStep],
  );

  const recordKeystroke = useCallback(
    (prevText: string, prevCaret: number, nextText: string) => {
      if (!openTypingStepRef.current) {
        pastRef.current.push({ text: prevText, caret: prevCaret });
        futureRef.current = [];
        openTypingStepRef.current = true;
      }
      if (!insertSessionOpenRef.current && /\s/.test(typedDelta(prevText, nextText))) {
        openTypingStepRef.current = false;
      }
    },
    [],
  );

  const performUndo = useCallback(
    (count: number) => {
      const ta = args.textareaRef.current;
      if (!ta) return;
      closeOpenTypingStep();
      let moved = false;
      for (let i = 0; i < Math.max(1, count) && pastRef.current.length > 0; i++) {
        const prev = pastRef.current.pop() as HistorySnapshot;
        futureRef.current.push({ text: ta.value, caret: ta.selectionStart });
        ta.value = prev.text;
        ta.setSelectionRange(prev.caret, prev.caret);
        moved = true;
      }
      if (moved) args.applyChange(ta.value, 'capability');
    },
    [args, closeOpenTypingStep],
  );

  const performRedo = useCallback(
    (count: number) => {
      const ta = args.textareaRef.current;
      if (!ta) return;
      closeOpenTypingStep();
      let moved = false;
      for (let i = 0; i < Math.max(1, count) && futureRef.current.length > 0; i++) {
        const next = futureRef.current.pop() as HistorySnapshot;
        pastRef.current.push({ text: ta.value, caret: ta.selectionStart });
        ta.value = next.text;
        ta.setSelectionRange(next.caret, next.caret);
        moved = true;
      }
      if (moved) args.applyChange(ta.value, 'capability');
    },
    [args, closeOpenTypingStep],
  );

  const undo = useCallback(() => performUndo(1), [performUndo]);
  const redo = useCallback(() => performRedo(1), [performRedo]);

  // Block/underline caret only ever renders while focused (SV4-4) — reset on
  // the focused->blurred falling edge so a stale mode doesn't survive a blur.
  const wasFocusedRef = useRef(args.focused);
  useEffect(() => {
    if (wasFocusedRef.current && !args.focused) {
      setCaretMode('bar');
    }
    wasFocusedRef.current = args.focused;
  }, [args.focused]);

  useEventListener(`UI:${args.events.onMotion}`, (evt: BusEvent) => {
    if (!args.editorId || !isMotionPayload(evt.payload) || evt.payload.editorId !== args.editorId) return;
    const { motion, count } = evt.payload;
    if (!isEditorMotion(motion)) {
      console.warn(`useEditorCapabilities: ignoring MOTION with unknown motion "${motion}"`);
      return;
    }
    const ta = args.textareaRef.current;
    if (!ta) return;
    const selecting = ta.selectionStart !== ta.selectionEnd;
    // The end that moves: the caret, or a held selection's far end from its anchor.
    const backward = ta.selectionDirection === 'backward';
    const moving = selecting && !backward ? ta.selectionEnd : ta.selectionStart;
    const newCaret = applyMotion(ta.value, moving, motion, count);
    // A held selection EXTENDS from its anchor to the new caret instead of
    // collapsing, so repeated motions grow/shrink a VISUAL-style selection —
    // in either direction.
    if (selecting) {
      const anchor = backward ? ta.selectionEnd : ta.selectionStart;
      ta.setSelectionRange(Math.min(anchor, newCaret), Math.max(anchor, newCaret), newCaret < anchor ? 'backward' : 'forward');
    } else {
      ta.setSelectionRange(newCaret, newCaret);
    }
    args.onCaret?.(newCaret);
  });

  useEventListener(`UI:${args.events.onOperate}`, (evt: BusEvent) => {
    if (!args.editorId || !isOperatePayload(evt.payload) || evt.payload.editorId !== args.editorId) return;
    const { operator, motion, count } = evt.payload;
    if (!isEditorOperator(operator)) {
      console.warn(`useEditorCapabilities: ignoring OPERATE with unknown operator "${operator}"`);
      return;
    }
    if (!isEditorMotion(motion)) {
      console.warn(`useEditorCapabilities: ignoring OPERATE with unknown motion "${motion}"`);
      return;
    }
    const ta = args.textareaRef.current;
    if (!ta) return;

    if (operator === 'undo') {
      performUndo(count);
      return;
    }
    if (operator === 'redo') {
      performRedo(count);
      return;
    }

    pushHistoryStep(ta.value, ta.selectionStart);

    const selection: [number, number] | undefined =
      motion === 'selection' ? [ta.selectionStart, ta.selectionEnd] : undefined;
    const range = motionRange(ta.value, ta.selectionStart, motion, count, selection);
    const result = applyOperator({
      text: ta.value,
      caret: ta.selectionStart,
      range,
      operator,
      motion,
      count,
      register: registerRef.current,
      registerLinewise: registerLinewiseRef.current,
    });
    registerRef.current = result.register;
    registerLinewiseRef.current = result.registerLinewise;

    if (operator === 'yank') {
      ta.setSelectionRange(result.caret, result.caret);
      args.onCaret?.(result.caret);
    } else {
      ta.value = result.text;
      ta.setSelectionRange(result.caret, result.caret);
    }
    args.applyChange(ta.value, 'capability');
  });

  useEventListener(`UI:${args.events.onInsertText}`, (evt: BusEvent) => {
    if (!args.editorId || !isInsertTextPayload(evt.payload) || evt.payload.editorId !== args.editorId) return;
    const ta = args.textareaRef.current;
    if (!ta) return;
    pushHistoryStep(ta.value, ta.selectionStart);
    ta.setRangeText(evt.payload.text, ta.selectionStart, ta.selectionEnd, 'end');
    args.applyChange(ta.value, 'capability');
  });

  useEventListener(`UI:${args.events.onSetMode}`, (evt: BusEvent) => {
    if (!args.editorId || !isSetModePayload(evt.payload) || evt.payload.editorId !== args.editorId) return;
    closeOpenTypingStep();
    insertSessionOpenRef.current = evt.payload.mode === 'INSERT';
    setCaretMode(evt.payload.caret);
    setCapturedKeys(Array.isArray(evt.payload.keys) ? new Set(evt.payload.keys.filter((k): k is string => typeof k === 'string')) : NO_KEYS);
  });

  return { caretMode, recordKeystroke, undo, redo, capturedKeys };
}
