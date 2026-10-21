/**
 * What an editable CodeBlock's completion provider answers: the caret's valid
 * continuations (the language's own tables — e.g. `orb complete` for `.lolo`).
 * Types only, in `lib/` so component props that name them resolve (pattern-sync
 * reads `lib/` for prop types).
 */

export interface CodeCompletion {
  label: string;
  detail?: string;
}

export interface CodeCompletionResult {
  /** The text before the caret a candidate replaces. */
  prefix: string;
  candidates: readonly CodeCompletion[];
}

/** `offset` is the caret as a JavaScript string index (UTF-16 code units). */
export type CodeCompletionProvider = (code: string, offset: number) => Promise<CodeCompletionResult | null>;
