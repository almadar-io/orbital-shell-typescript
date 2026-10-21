/**
 * Model-assisted editing for an editable CodeBlock. A `CodeAssistProvider`
 * answers "what next?" — a completion at the caret (asked after a pause or on
 * Ctrl-Space) or fixes for the file's problems (⌘/Ctrl-.) — as suggested edits.
 * Tab accepts the next, ⌘/Ctrl-Enter accepts all, Escape dismisses.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { applySuggestions, orderSuggestions, remapSuggestions, singleChange, type CodeAssistProvider, type CodeAssistRequest, type CodeAssistResult, type CodeSuggestion } from '../lib/codeAssist';

export type { CodeAssistProvider, CodeAssistRequest, CodeAssistResult } from '../lib/codeAssist';

const IDLE_MS = 600;
const NAVIGATION_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
  'Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape', 'CapsLock',
]);

export interface CodeAssistState {
  /** Pending suggestions, in Tab order, valid for the textarea's current value. */
  suggestions: readonly CodeSuggestion[];
  note: string | null;
  /** The pending set answers `complete` at the caret (a ghost), not `fix`. */
  atCaret: boolean;
  asking: CodeAssistRequest['kind'] | null;
  /** True when the key was consumed. */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Call with the value before and after every edit that did not come from the assist. */
  onEdited: (prev: string, next: string) => void;
  /** A completion belongs to its caret: moving away drops it. */
  onCaretMoved: (caret: number) => void;
  request: (kind: CodeAssistRequest['kind'], trigger: CodeAssistRequest['trigger']) => void;
  accept: (s: CodeSuggestion) => void;
  acceptAll: () => void;
  dismiss: () => void;
}

export function useCodeAssist(
  provider: CodeAssistProvider | undefined,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  apply: (next: string, caret: number) => void,
  /** False while the language's own answer is the better one (its list, narrowed by a prefix): a pause then asks nothing. */
  askOnPause: () => boolean = () => true,
): CodeAssistState {
  const [suggestions, setSuggestions] = useState<readonly CodeSuggestion[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState<CodeAssistRequest['kind'] | null>(null);
  const [atCaret, setAtCaret] = useState(false);
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<readonly CodeSuggestion[]>([]);
  current.current = suggestions;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const set = useCallback((next: readonly CodeSuggestion[]) => {
    current.current = next;
    setSuggestions(next);
  }, []);

  const request = useCallback((kind: CodeAssistRequest['kind'], trigger: CodeAssistRequest['trigger']) => {
    const ta = textareaRef.current;
    if (!provider || !ta) return;
    if (timer.current) clearTimeout(timer.current);
    const id = ++latest.current;
    const req: CodeAssistRequest = { code: ta.value, offset: ta.selectionStart, kind, trigger };
    setAsking(kind);
    void provider(req).then(
      (result) => {
        if (id !== latest.current) return;
        setAsking(null);
        // The answer is for `req.code`; the author may have typed since.
        if (textareaRef.current?.value !== req.code) return;
        set(result ? orderSuggestions(result.suggestions, req.offset) : []);
        setAtCaret(kind === 'complete');
        setNote(result?.note ?? null);
      },
      () => {
        if (id === latest.current) setAsking(null);
      },
    );
  }, [provider, textareaRef, set]);

  const dismiss = useCallback(() => {
    latest.current++;
    if (timer.current) clearTimeout(timer.current);
    setAsking(null);
    setNote(null);
    set([]);
  }, [set]);

  const commit = useCallback((chosen: readonly CodeSuggestion[], rest: readonly CodeSuggestion[]) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const next = applySuggestions(ta.value, chosen, ta.selectionStart);
    let left: readonly CodeSuggestion[] = rest;
    for (const s of [...chosen].sort((a, b) => b.from - a.from)) left = remapSuggestions(left, s);
    latest.current++;
    set(left);
    if (left.length === 0) setNote(null);
    apply(next.code, next.caret);
  }, [textareaRef, apply, set]);

  const accept = useCallback((s: CodeSuggestion) => {
    commit([s], current.current.filter((x) => x !== s));
  }, [commit]);

  const acceptAll = useCallback(() => {
    commit(current.current, []);
  }, [commit]);

  const onEdited = useCallback((prev: string, next: string) => {
    const change = singleChange(prev, next);
    if (change && current.current.length > 0) set(remapSuggestions(current.current, change));
  }, [set]);

  const onCaretMoved = useCallback((caret: number) => {
    const first = current.current[0];
    if (atCaret && first && first.from !== caret) set([]);
  }, [atCaret, set]);

  const onKeyUp = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!provider || NAVIGATION_KEYS.has(e.key) || e.ctrlKey || e.metaKey) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (askOnPause()) request('complete', 'idle');
    }, IDLE_MS);
  }, [provider, request, askOnPause]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!provider) return false;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === '.') {
      e.preventDefault();
      request('fix', 'explicit');
      return true;
    }
    if (e.key === ' ' && e.ctrlKey) {
      request('complete', 'explicit');
      return false;
    }
    const pending = current.current;
    if (pending.length === 0) return false;
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      accept(pending[0]);
      return true;
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      acceptAll();
      return true;
    }
    if (e.key === 'Escape') {
      dismiss();
      return true;
    }
    return false;
  }, [provider, request, accept, acceptAll, dismiss]);

  return { suggestions, note, atCaret, asking, onKeyDown, onKeyUp, onEdited, onCaretMoved, request, accept, acceptAll, dismiss };
}
