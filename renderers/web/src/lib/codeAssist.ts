/**
 * Suggested edits for an editable CodeBlock: each replaces `[from, to)` of the
 * code it was made for with `text` (JS string indices). The editor keeps them
 * true while the author types, and applies one or all.
 */

export interface CodeSuggestion {
  from: number;
  to: number;
  text: string;
  /** Why this edit (shown beside it). */
  why?: string;
}

export interface CodeChange {
  from: number;
  to: number;
  text: string;
}

/** The one span that differs between `prev` and `next`, as an edit on `prev`. */
export function singleChange(prev: string, next: string): CodeChange | null {
  if (prev === next) return null;
  let start = 0;
  const max = Math.min(prev.length, next.length);
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--;
    endNext--;
  }
  return { from: start, to: endPrev, text: next.slice(start, endNext) };
}

/**
 * Carry suggestions across an edit: those wholly before or after it stay (shifted);
 * an insertion the author is typing through shrinks; anything the edit touches is dropped.
 */
export function remapSuggestions(suggestions: readonly CodeSuggestion[], change: CodeChange): CodeSuggestion[] {
  const delta = change.text.length - (change.to - change.from);
  const out: CodeSuggestion[] = [];
  for (const s of suggestions) {
    const typedThrough = s.from === s.to && change.from === s.from && change.to === s.from && change.text.length > 0;
    if (typedThrough) {
      if (s.text.startsWith(change.text) && s.text.length > change.text.length) {
        const at = s.from + change.text.length;
        out.push({ ...s, from: at, to: at, text: s.text.slice(change.text.length) });
      }
      continue;
    }
    if (change.to <= s.from && !(change.from === s.from && change.to === s.from)) out.push({ ...s, from: s.from + delta, to: s.to + delta });
    else if (change.from >= s.to && !(change.from === s.to && change.to === s.to && s.from === s.to)) out.push(s);
  }
  return out;
}

/** Apply every suggestion (bottom-up), mapping the caret through them. */
export function applySuggestions(code: string, suggestions: readonly CodeSuggestion[], caret: number): { code: string; caret: number } {
  const ordered = [...suggestions].sort((a, b) => b.from - a.from);
  let next = code;
  let at = caret;
  for (const s of ordered) {
    next = next.slice(0, s.from) + s.text + next.slice(s.to);
    if (s.from === s.to && s.from === at) at += s.text.length;
    else if (s.to <= at) at += s.text.length - (s.to - s.from);
    else if (s.from < at) at = s.from + s.text.length;
  }
  return { code: next, caret: at };
}

/** Tab's order: the suggestion at the caret first, then the rest by position. */
export function orderSuggestions(suggestions: readonly CodeSuggestion[], caret: number): CodeSuggestion[] {
  const byPos = [...suggestions].sort((a, b) => a.from - b.from);
  const i = byPos.findIndex((s) => s.from === caret && s.to === caret);
  return i < 0 ? byPos : [byPos[i], ...byPos.slice(0, i), ...byPos.slice(i + 1)];
}

export interface CodeAssistRequest {
  code: string;
  /** The caret, as a JavaScript string index. */
  offset: number;
  kind: 'complete' | 'fix';
  trigger: 'idle' | 'explicit';
}

export interface CodeAssistResult {
  suggestions: readonly CodeSuggestion[];
  /** A short line for the author (e.g. what is left after the fixes). */
  note?: string;
}

/** What an editable CodeBlock's model assist answers: a completion at the caret, or fixes for its problems. */
export type CodeAssistProvider = (request: CodeAssistRequest) => Promise<CodeAssistResult | null>;
