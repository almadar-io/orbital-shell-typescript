'use client';
/**
 * useKeyboardRouter
 *
 * Declared-data keyboard capture: routes every `keydown` through a
 * caller-owned capture table (`editorId -> {mode, keys}`, or the literal
 * `'shell'` for chrome-level bindings), keyed by whichever editor is
 * currently focused. Focus is tracked ONLY via bus events
 * (`UI:EDITOR_FOCUS` / `UI:EDITOR_BLUR`) — never `document.activeElement`
 * or a DOM attribute lookup. This hook is the SOLE emitter of `UI:KEY`.
 * No heuristics: every capture decision comes from the declared table.
 *
 * Capture rule: a keydown is `preventDefault`ed iff the focused target's
 * entry lists it — as the bare `event.key` (`"k"`, `"Escape"`), or as a
 * chord `"<Modifiers>+<key>"` with modifiers in the fixed order
 * `Control`, `Alt`, `Shift`, `Meta` (`"Meta+k"`, `"Control+Shift+P"`).
 * `mode` is the trait state the entry belongs to — informational for the
 * host, never a capture decision: an entry with `mode: 'any'` and no keys
 * captures nothing (it used to capture EVERY key at shell level, which
 * blocked typing in every plain input — `docs/Almadar_UI_Gaps.md`
 * U-KEYBOARD-ROUTER-CAPTURE-ALL).
 *
 * @packageDocumentation
 */

import { useEffect, useRef } from 'react';
import { useEventBus } from '../core';

export interface KeyCaptureEntry {
  mode: string;
  keys: ReadonlySet<string>;
}

/** keyed by editorId, or the literal 'shell' for chrome-level bindings */
export type KeyCaptureTable = Readonly<Record<string, KeyCaptureEntry>>;

export interface EditorKeyEvent {
  editorId: string;
  key: string;
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  repeat: boolean;
}

/**
 * Merges several plugins' capture tables into one, per target: keys UNION
 * across every table that declares the target; `mode` is `'any'` if any
 * input says so, else the shared mode when every input agrees, else the
 * distinct modes sorted and `|`-joined. A target present in only one table
 * passes through unchanged. Pure, deterministic — no heuristics.
 */
export function mergeCaptureTables(tables: readonly KeyCaptureTable[]): KeyCaptureTable {
  const merged: Record<string, { mode: string; keys: Set<string> }> = {};
  for (const table of tables) {
    for (const [target, entry] of Object.entries(table)) {
      const current = merged[target];
      if (!current) {
        merged[target] = { mode: entry.mode, keys: new Set(entry.keys) };
        continue;
      }
      for (const key of entry.keys) current.keys.add(key);
      if (current.mode === 'any' || entry.mode === 'any') current.mode = 'any';
      else if (current.mode !== entry.mode) {
        current.mode = Array.from(new Set([...current.mode.split('|'), entry.mode])).sort().join('|');
      }
    }
  }
  return merged;
}

/** `"Control+Shift+P"`-style spelling of a keydown: modifiers in the fixed order Control, Alt, Shift, Meta, then `event.key`. */
export function keyChord(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(event.key);
  return parts.join('+');
}

export interface UseKeyboardRouterOptions {
  /** declared data; caller owns it; re-read on every keydown (kept in a ref) */
  captureTable: KeyCaptureTable;
  /** default 'EDITOR_FOCUS' -> subscribes UI:EDITOR_FOCUS {editorId} */
  editorFocusEvent?: string;
  /** default 'EDITOR_BLUR' */
  editorBlurEvent?: string;
  /** default 'KEY' -> emits UI:KEY */
  keyEvent?: string;
  /** default true */
  enabled?: boolean;
}

export function useKeyboardRouter(options: UseKeyboardRouterOptions): void {
  const {
    captureTable,
    editorFocusEvent = 'EDITOR_FOCUS',
    editorBlurEvent = 'EDITOR_BLUR',
    keyEvent = 'KEY',
    enabled = true,
  } = options;

  const eventBus = useEventBus();
  const captureTableRef = useRef(captureTable);
  captureTableRef.current = captureTable;
  const focusedEditorIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubFocus = eventBus.on(`UI:${editorFocusEvent}`, (event) => {
      const editorId = event.payload?.editorId;
      if (typeof editorId === 'string') {
        focusedEditorIdRef.current = editorId;
      }
    });
    const unsubBlur = eventBus.on(`UI:${editorBlurEvent}`, (event) => {
      const editorId = event.payload?.editorId;
      if (typeof editorId === 'string' && focusedEditorIdRef.current === editorId) {
        focusedEditorIdRef.current = null;
      }
    });
    return () => {
      unsubFocus();
      unsubBlur();
    };
  }, [eventBus, editorFocusEvent, editorBlurEvent]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;

      const target = focusedEditorIdRef.current ?? 'shell';
      const entry = captureTableRef.current[target];
      const captured = entry !== undefined && (entry.keys.has(event.key) || entry.keys.has(keyChord(event)));

      if (captured) {
        event.preventDefault();
      }

      eventBus.emit(`UI:${keyEvent}`, {
        editorId: target,
        key: event.key,
        code: event.code,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
        repeat: event.repeat,
      } satisfies EditorKeyEvent);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [eventBus, enabled, keyEvent]);
}
