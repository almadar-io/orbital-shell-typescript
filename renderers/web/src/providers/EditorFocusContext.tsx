'use client';
/**
 * EditorFocusContext — which editor holds keyboard focus, as React context. A focusable editor (CodeBlock) reports its own
 * focus and blur here; the keyboard router reads it to pick the capture-table entry a keydown belongs to.
 */
import React, { createContext, useContext, useMemo } from 'react';

export interface EditorFocus {
  /** The editor holding focus, or `null` when none does. */
  focused: () => string | null;
  focus: (editorId: string) => void;
  /** Releases focus only when `editorId` still holds it, so a late blur never clears a newer focus. */
  blur: (editorId: string) => void;
}

function createEditorFocus(): EditorFocus {
  let current: string | null = null;
  return {
    focused: () => current,
    focus: (editorId) => { current = editorId; },
    blur: (editorId) => { if (current === editorId) current = null; },
  };
}

const INERT_EDITOR_FOCUS: EditorFocus = { focused: () => null, focus: () => undefined, blur: () => undefined };

const EditorFocusContext = createContext<EditorFocus>(INERT_EDITOR_FOCUS);

export const EditorFocusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const focus = useMemo(createEditorFocus, []);
  return <EditorFocusContext.Provider value={focus}>{children}</EditorFocusContext.Provider>;
};
EditorFocusProvider.displayName = 'EditorFocusProvider';

/** Outside an `EditorFocusProvider` nothing is ever focused: the router targets `'shell'`. */
export function useEditorFocus(): EditorFocus {
  return useContext(EditorFocusContext);
}
