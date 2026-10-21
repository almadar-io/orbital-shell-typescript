/**
 * Assisted editing for an editable CodeBlock: a `CodeCompletionProvider` answers "what may
 * follow the caret?" (the language's own tables — e.g. `orb complete` for `.lolo`); the editor
 * offers the answer and inserts the chosen candidate in place of the typed prefix.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

import type { CodeCompletionProvider, CodeCompletionResult } from '../lib/codeCompletion';

export type { CodeCompletion, CodeCompletionProvider, CodeCompletionResult } from '../lib/codeCompletion';

/** The prefix typed before `offset` is replaced by `label`; the caret lands after it. */
export function applyCompletion(code: string, offset: number, prefix: string, label: string): { code: string; caret: number } {
  const at = Math.min(offset, code.length);
  const start = Math.max(0, at - prefix.length);
  return { code: code.slice(0, start) + label + code.slice(at), caret: start + label.length };
}

const REQUEST_DEBOUNCE_MS = 120;
const NAVIGATION_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
  'Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape', 'Enter',
]);

interface Offer {
  result: CodeCompletionResult;
  offset: number;
  /** The text the candidates were computed for: once the buffer moves on, the offer is stale. */
  code: string;
}

export interface CodeCompletionState {
  offer: Offer | null;
  /** Index of the highlighted candidate (↑/↓ move it; Tab takes it). */
  selected: number;
  /** Whether a list narrowed by a typed prefix is open now (current even before the next render). */
  isNarrowed: () => boolean;
  /** True when the key was consumed (the caller must not handle it further). */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  accept: (label: string) => void;
  dismiss: () => void;
}

export function useCodeCompletion(
  provider: CodeCompletionProvider | undefined,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  apply: (next: string, caret: number) => void,
): CodeCompletionState {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [selected, setSelected] = useState(0);
  const narrowed = useRef(false);
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const ask = useCallback(() => {
    const ta = textareaRef.current;
    if (!provider || !ta) return;
    const id = ++latest.current;
    const code = ta.value;
    const offset = ta.selectionStart;
    void provider(code, offset).then((result) => {
      if (id !== latest.current) return;
      const next = result && result.candidates.length > 0 ? { result, offset, code } : null;
      narrowed.current = next !== null && next.result.prefix.length > 0;
      setOffer(next);
      setSelected(0);
    });
  }, [provider, textareaRef]);

  const dismiss = useCallback(() => {
    latest.current++;
    narrowed.current = false;
    setOffer(null);
  }, []);

  const accept = useCallback((label: string) => {
    const ta = textareaRef.current;
    if (!offer || !ta) return;
    if (ta.value !== offer.code) {
      dismiss();
      return;
    }
    const next = applyCompletion(ta.value, offer.offset, offer.result.prefix, label);
    dismiss();
    apply(next.code, next.caret);
  }, [offer, textareaRef, apply, dismiss]);

  const onKeyUp = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!provider || NAVIGATION_KEYS.has(e.key) || e.ctrlKey || e.metaKey) return;
    if (offer && textareaRef.current?.value !== offer.code) {
      narrowed.current = false;
      setOffer(null);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(ask, REQUEST_DEBOUNCE_MS);
  }, [provider, ask, offer, textareaRef]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!provider) return false;
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      ask();
      return true;
    }
    const count = offer?.result.candidates.length ?? 0;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && count > 0) {
      e.preventDefault();
      setSelected((i) => (i + (e.key === 'ArrowDown' ? 1 : count - 1)) % count);
      return true;
    }
    const fresh = offer !== null && textareaRef.current?.value === offer.code;
    const chosen = fresh ? offer.result.candidates[Math.min(selected, count - 1)] : undefined;
    if (e.key === 'Tab' && chosen) {
      e.preventDefault();
      accept(chosen.label);
      return true;
    }
    if (e.key === 'Escape' && offer) {
      dismiss();
      return true;
    }
    return false;
  }, [provider, offer, selected, ask, accept, dismiss, textareaRef]);

  const isNarrowed = useCallback(() => narrowed.current, []);

  return { offer, selected, isNarrowed, onKeyDown, onKeyUp, accept, dismiss };
}
