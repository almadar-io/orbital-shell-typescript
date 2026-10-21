/**
 * CodeBlock Molecule Component
 *
 * A syntax-highlighted code block with copy-to-clipboard functionality.
 * Preserves scroll position during re-renders.
 *
 * Event Contract:
 * - Emits: UI:COPY_CODE { language, success }
 * - Emits: UI:EDITOR_FOCUS { editorId }
 * - Emits: UI:EDITOR_BLUR { editorId }
 *
 * The editor capability props (`onMotion` / `onOperate` / `onInsertText` /
 * `onSetMode`) are declarative bus LISTENS (`EventListen<P>`), not emits —
 * `extractEventsFromJSDoc` (tools/almadar-pattern-sync/parser.ts) only parses
 * "Emits:" lines, so they are omitted here; the registry extractor picks them
 * up structurally via the `EventListen<P>` brand on each prop instead.
 */

import React, { useState, useRef, useLayoutEffect, useEffect, useMemo, useCallback } from 'react';
import { cn } from '../../../../core';
import type { EditorMotion, EditorOperator } from '../../../../lib/editorMotions';
import { Card, Typography } from '../../../../core';
import { Tabs, type TabItem } from '../Tabs';
import { LoadingState } from '../LoadingState';
import { ErrorState } from '../ErrorState';
import { EmptyState } from '../EmptyState';
import { Copy, Check, FileText, Code as CodeIcon, WrapText } from 'lucide-react';
import type { UiError } from '../../../../core';
import type { SyntaxHighlighterProps } from 'react-syntax-highlighter';
import { ORB_COLORS, translateLolo, translateOrb } from '@almadar/syntax';
import { getVocabulary, type LanguageCode } from '@almadar/core/i18n';

// ── The highlighter, loaded on demand ────────────────────────────────────────
// PrismLight, its grammars and schemes live in `./prism` and load the first time a block mounts (G-UI-105); until
// then a block shows its code as plain monospace text.
type Prism = typeof import('./prism.js').prism;
let loadedPrism: Prism | undefined;
let prismLoad: Promise<Prism> | undefined;

function loadPrism(): Promise<Prism> {
  prismLoad ??= import('./prism.js').then((module) => (loadedPrism = module.prism));
  return prismLoad;
}

/** Load the highlighter ahead of the first block (an app that shows code at once, a test): blocks then paint highlighted. */
export async function preloadCodeHighlighter(): Promise<void> {
  await loadPrism();
}

/** The highlighter, once loaded; a component that renders before then re-renders when it arrives. */
function usePrism(): Prism | undefined {
  const [prism, setPrism] = useState(loadedPrism);
  useEffect(() => {
    if (prism !== undefined) return;
    let active = true;
    void loadPrism().then((loaded) => { if (active) setPrism(loaded); });
    return () => { active = false; };
  }, [prism]);
  return prism;
}

/** The highlighter a renderer callback runs with: it only runs inside a highlighter, which is loaded. */
function prismOrThrow(): Prism {
  if (loadedPrism === undefined) throw new Error('CodeBlock: the highlighter renderer ran before the highlighter loaded');
  return loadedPrism;
}

// ── Dynamic Prism language loading ───────────────────────────────────────────
// Any language outside the static set above is fetched on demand. Because
// `@almadar/ui` is pre-bundled by the consumer's bundler, a template-literal
// dynamic import here would not be code-split — so the loader is injected from
// app source (where the bundler can split each grammar into its own lazy chunk)
// via `registerCodeLanguageLoader`. Apps call it once at bootstrap.
const dynamicallyLoaded = new Set<string>();

/** A PrismLight grammar module's default export: a function that registers
 *  token definitions on the Prism/refractor instance passed to it. */
export type PrismLanguageGrammar = (prism: object) => void;

/** A consumer-supplied async grammar fetcher. Returns the language module
 *  default (registered with PrismLight), or `null` if no grammar exists. */
export type CodeLanguageLoader = (lang: string) => Promise<PrismLanguageGrammar | null>;

let codeLanguageLoader: CodeLanguageLoader | null = null;

/** Wire up a dynamic language-grammar loader. Must be called from app source
 *  (not a pre-bundled dependency) so the bundler can split grammars into chunks. */
export function registerCodeLanguageLoader(loader: CodeLanguageLoader | null): void {
  codeLanguageLoader = loader;
}

function isLanguageRegistered(lang: string): boolean {
  return loadedPrism !== undefined && (CODE_LANGUAGE_SET.has(lang) || dynamicallyLoaded.has(lang));
}

async function loadPrismLanguage(lang: string): Promise<void> {
  await loadPrism();
  if (isLanguageRegistered(lang)) return;
  try {
    const grammar = codeLanguageLoader ? await codeLanguageLoader(lang) : null;
    // Fallback: no dedicated grammar → register the generic C-like base grammar
    // under this language id so obscure code still gets basic token coloring
    // (comments, strings, numbers, keywords) instead of plain text.
    const prism = await loadPrism();
    prism.SyntaxHighlighter.registerLanguage(lang, grammar ?? prism.clike);
    dynamicallyLoaded.add(lang);
  } catch {
    dynamicallyLoaded.add(lang);
  }
}

type SyntaxScheme = 'light' | 'dark';
type SyntaxPalette = (typeof ORB_COLORS)[SyntaxScheme];

// AVL-aligned style overrides for .orb token classes
const orbStyleOverrides = (c: SyntaxPalette): Record<string, React.CSSProperties> => ({
  'orb-binding':     { color: c.binding, fontWeight: 'bold' },
  'orb-effect':      { color: c.effect, fontWeight: 'bold' },
  'orb-event':       { color: c.event },
  'orb-slot':        { color: c.uiSlot },
  'orb-structural':  { color: c.structural },
  'orb-field-type':  { color: c.fieldType },
  'orb-persistence': { color: c.persistence },
  'orb-pattern':     { color: c.pattern },
  'orb-behavior':    { color: c.behavior },
  'orb-unknown-op':  { color: c.error, textDecoration: 'wavy underline' },
  'orb-op-arithmetic': { color: c.arithmetic, fontWeight: 'bold' },
  'orb-op-comparison': { color: c.comparison },
  'orb-op-logic':    { color: c.logic },
  'orb-op-string':   { color: c.string },
  'orb-op-collection': { color: c.collection },
  'orb-op-time':     { color: c.time },
  'orb-op-control':  { color: c.control },
  'orb-op-async':    { color: c.async },
});

// AVL-aligned style overrides for .lolo token classes (Haskell-inspired palette)
const loloStyleOverrides = (c: SyntaxPalette): Record<string, React.CSSProperties> => ({
  'lolo-binding':       { color: c.binding, fontWeight: 'bold' },
  'lolo-event':         { color: c.event },
  'lolo-effect':        { color: c.effect, fontWeight: 'bold' },
  'keyword':            { color: c.loloKeyword },
  'lolo-constructor':   { color: c.loloConstructor },
  'lolo-arrow':         { color: c.loloArrow },
  'lolo-reference':     { color: c.loloReference },
  'lolo-type':          { color: c.fieldType },
  'lolo-persistence':   { color: c.persistence },
  'lolo-unknown-op':    { color: c.error },
  'lolo-op-arithmetic': { color: c.arithmetic, fontWeight: 'bold' },
  'lolo-op-comparison': { color: c.comparison },
  'lolo-op-logic':      { color: c.logic },
  'lolo-op-string':     { color: c.string },
  'lolo-op-collection': { color: c.collection },
  'lolo-op-time':       { color: c.time },
  'lolo-op-control':    { color: c.control },
  'lolo-op-async':      { color: c.async },
});

type SchemeStyles = { base: Record<string, React.CSSProperties>; orb: Record<string, React.CSSProperties>; lolo: Record<string, React.CSSProperties> };
const HIGHLIGHT_STYLES = new Map<SyntaxScheme, SchemeStyles>();

/** A scheme's style sheets, built once from the loaded highlighter's base scheme. */
function schemeStyles(prism: Prism, scheme: SyntaxScheme): SchemeStyles {
  const held = HIGHLIGHT_STYLES.get(scheme);
  if (held !== undefined) return held;
  const base = scheme === 'dark' ? prism.dark : prism.light;
  const colors = scheme === 'dark' ? ORB_COLORS.dark : ORB_COLORS.light;
  const built = { base, orb: { ...base, ...orbStyleOverrides(colors) }, lolo: { ...base, ...loloStyleOverrides(colors) } };
  HIGHLIGHT_STYLES.set(scheme, built);
  return built;
}

/** Before the highlighter loads, a block's plain text takes the scheme's foreground. */
const PLAIN_STYLES: Record<SyntaxScheme, Record<string, React.CSSProperties>> = {
  dark: { 'code[class*="language-"]': { color: '#d4d4d4' } },
  light: { 'code[class*="language-"]': { color: '#383a42' } },
};

// ── Fold region computation ──────────────────────────────────────────

interface FoldRegion {
  start: number;
  end: number;
  closeBracket: string;
}

/** Find matching bracket pairs that span multiple lines (respects JSON strings). */
function computeFoldRegions(code: string): FoldRegion[] {
  const lines = code.split('\n');
  const regions: FoldRegion[] = [];
  const stack: { line: number; bracket: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let inString = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '\\' && inString) { j++; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{' || ch === '[') {
        stack.push({ line: i, bracket: ch });
      } else if (ch === '}' || ch === ']') {
        const open = stack.pop();
        if (open && open.line < i) {
          regions.push({
            start: open.line,
            end: i,
            closeBracket: ch,
          });
        }
      }
    }
  }
  return regions.sort((a, b) => a.start - b.start);
}

import { Box } from '../../../../core';
import { Button } from '../../../../core';
import { Badge } from '../../../../core';
import { HStack } from '../../../../core';
import { useCodeCompletion, type CodeCompletionProvider } from '../../../../hooks/useCodeCompletion';
import { useCodeAssist, type CodeAssistProvider } from '../../../../hooks/useCodeAssist';
export { type CodeAssistProvider, type CodeAssistRequest, type CodeAssistResult } from '../../../../hooks/useCodeAssist';
export { applySuggestions, type CodeSuggestion } from '../../../../lib/codeAssist';
import { identifierAt, type CodeIdentifier } from '../../../../lib/codeIdentifiers';
import { diagnosticAt, diagnosticRanges, remapRanges, underlineSegments, type CodeDiagnostic, type DiagnosticRange } from '../../../../lib/codeDiagnostics';
export { type CodeDiagnostic } from '../../../../lib/codeDiagnostics';
export { applyCompletion, type CodeCompletion, type CodeCompletionProvider, type CodeCompletionResult } from '../../../../hooks/useCodeCompletion';
import { Textarea } from '../../../../core';

const MONO_EDITOR_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Courier New", monospace';
const GHOST_COLOR = '#7f848e';
const GUTTER_COLOR = '#858585';
/** A selection's moving end — where the caret is drawn. */
const caretOf = (ta: HTMLTextAreaElement): number => (ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd);

type HighlightRows = Parameters<NonNullable<SyntaxHighlighterProps['renderer']>>[0];
type HighlightNode = HighlightRows['rows'][number];

/** A highlighted node with its token classes kept as `data-token` (inline styles drop them from `className`). */
function withTokenTypes(node: HighlightNode): HighlightNode {
  if (node.type !== 'element') return node;
  const classes = node.properties?.className;
  return {
    ...node,
    ...(node.properties
      ? { properties: { ...node.properties, ...(Array.isArray(classes) && classes.length > 0 ? { 'data-token': classes.join(' ') } : {}) } }
      : {}),
    ...(node.children ? { children: node.children.map(withTokenTypes) } : {}),
  };
}

/** The editor's highlighter renderer: the stock element builder over token-typed nodes. */
function renderWithTokenTypes({ rows, stylesheet, useInlineStyles }: HighlightRows): React.ReactNode {
  return rows.map((node, i) => prismOrThrow().createHighlightElement({ node: withTokenTypes(node), stylesheet, useInlineStyles, key: `code-segment-${i}` }));
}

/** A run of English letters/digits, read as one LTR word inside RTL code (identifiers, `@entity.total`, `?amount`, numbers). */
const LTR_WORD = /[A-Za-z0-9_$@?][A-Za-z0-9_$@?.!-]*/g;
const LTR_ISLAND_STYLE: React.CSSProperties = { unicodeBidi: 'isolate', direction: 'ltr' };
/** A string literal keeps its own first-strong direction, so an English sentence reads whole and an Arabic one reads RTL. */
const STRING_ISLAND_STYLE: React.CSSProperties = { unicodeBidi: 'plaintext' };

function island(value: string, style: React.CSSProperties): HighlightNode {
  return { type: 'element', tagName: 'span', properties: { className: [], 'data-bidi-island': '', style }, children: [{ type: 'text', value }] };
}

function splitLtrWords(value: string): HighlightNode[] {
  const out: HighlightNode[] = [];
  let last = 0;
  for (const match of value.matchAll(LTR_WORD)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ type: 'text', value: value.slice(last, start) });
    out.push(island(match[0], LTR_ISLAND_STYLE));
    last = start + match[0].length;
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

/** RTL code: brackets, arrows and spaces stay in the RTL flow (so they mirror); each English word or string is an isolated island. */
function withBidiIslands(node: HighlightNode): HighlightNode[] {
  if (node.type === 'text') return splitLtrWords(String(node.value ?? ''));
  if (node.type !== 'element') return [node];
  const classes = node.properties?.className;
  if (Array.isArray(classes) && classes.includes('string')) {
    return [{ ...node, properties: { ...node.properties, className: classes, 'data-bidi-island': '', style: STRING_ISLAND_STYLE } }];
  }
  return [{ ...node, ...(node.children ? { children: node.children.flatMap(withBidiIslands) } : {}) }];
}

function renderRtlCode({ rows, stylesheet, useInlineStyles }: HighlightRows): React.ReactNode {
  return rows.map((node, i) =>
    withBidiIslands(node).map((n, j) => prismOrThrow().createHighlightElement({ node: n, stylesheet, useInlineStyles, key: `code-rtl-${i}-${j}` })),
  );
}

/** The token types of the highlighted text at `offset` (`comment`, `string`, …); empty when unstyled. */
function tokenClassAt(layer: HTMLElement, offset: number): string {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let pos = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (offset < pos + length) return node.parentElement?.closest('[data-token]')?.getAttribute('data-token') ?? '';
    pos += length;
  }
  return '';
}

/**
 * The text offset under a point: the textarea is lifted out of hit-testing for one
 * lookup, so the point lands in the highlighted text beneath it, which holds the same
 * characters at the same places.
 */
function offsetUnderPointer(ta: HTMLTextAreaElement, layer: HTMLElement | null, x: number, y: number): number | null {
  if (!layer || typeof document.caretRangeFromPoint !== 'function') return null;
  const previous = ta.style.pointerEvents;
  ta.style.pointerEvents = 'none';
  const range = document.caretRangeFromPoint(x, y);
  ta.style.pointerEvents = previous;
  if (!range || !layer.contains(range.startContainer)) return null;
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let pos = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === range.startContainer) return pos + range.startOffset;
    pos += node.textContent?.length ?? 0;
  }
  return null;
}
const DIAGNOSTIC_ERROR_COLOR = '#f14c4c';
const DIAGNOSTIC_WARNING_COLOR = '#cca700';
/** 13px × 1.5 — the editable textarea's line box. */
const EDITOR_LINE_PX = 19.5;
import { Icon } from '../../../../core';
import { useEventBus } from '../../../../core';
import { keyChord, type EditorKeyEvent } from '../../../../hooks/useKeyboardRouter';
import { useTranslate } from '../../../../core';
import { useMediaQuery } from '../../../../core';
import { useScopedMode } from '../../../../core';
import { createLogger } from '@almadar/logger';
import type { A11yProps, EventEmit, EventKey, EventListen } from "@almadar/core";
import { domPassthrough } from '../../../../core';
import { useEditorCapabilities } from './useEditorCapabilities';
import { computeLineDiff } from '../../../../lib/lineDiff';

const log = createLogger('almadar:ui:markdown-code');

/**
 * The set of languages with a registered PrismLight grammar (above) plus the
 * `.orb`/`.lolo` grammars from `@almadar/syntax`. Authoritative: an unregistered
 * value renders as plain text, so this union mirrors the `registerLanguage`
 * calls exactly.
 */
export const CODE_LANGUAGES = [
  'text',
  'json',
  'javascript',
  'js',
  'typescript',
  'ts',
  'jsx',
  'tsx',
  'css',
  'markdown',
  'md',
  'bash',
  'shell',
  'sh',
  'yaml',
  'yml',
  'rust',
  'python',
  'py',
  'sql',
  'diff',
  'toml',
  'go',
  'graphql',
  'html',
  'xml',
  'clojure',
  'clj',
  'edn',
  'haskell',
  'hs',
  'lisp',
  'scheme',
  'scala',
  'elixir',
  'ex',
  'exs',
  'erlang',
  'erl',
  'elm',
  'fsharp',
  'fs',
  'fsx',
  'ocaml',
  'ml',
  'java',
  'c',
  'cpp',
  'c++',
  'cc',
  'cxx',
  'hpp',
  'h',
  'csharp',
  'cs',
  'objectivec',
  'objc',
  'php',
  'ruby',
  'rb',
  'swift',
  'kotlin',
  'kt',
  'lua',
  'r',
  'dart',
  'julia',
  'fortran',
  'f90',
  'f95',
  'perl',
  'pl',
  'powershell',
  'ps1',
  'makefile',
  'make',
  'nginx',
  'ini',
  'orb',
  'lolo',
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

const CODE_LANGUAGE_SET = new Set<string>(CODE_LANGUAGES);

/**
 * Normalize a fence info-string to a language id. Known languages pass through
 * as-is; unknown ids also pass through so they can be dynamically loaded by
 * `CodeBlock` (falling back to plain text if no Prism grammar exists).
 */
export function toCodeLanguage(value: string | undefined): string {
  if (!value) return 'text';
  return value.toLowerCase();
}

// ── Viewer types (absorbed from CodeViewer) ──────────────────────────────────

export type CodeViewerMode = 'code' | 'diff';

// ── Editor capability vocabulary (declaration-only in this wave; P1 wires
// the runtime behaviour) ──────────────────────────────────────────────────

export type { EditorMotion, EditorOperator } from '../../../../lib/editorMotions';
// Single source of truth for the closed vocabularies lives in `lib/editorMotions.ts`
// (it also builds `isEditorMotion`/`isEditorOperator` from these). Re-exported here
// since consumers historically import them from `CodeBlock`. The `motions`/
// `operators` prop DEFAULTS below must list the same members as JSON literals
// (the registry parser reads those literals) — `test/CodeBlock.editable.test.tsx`
// asserts the two stay in sync.
export { EDITOR_MOTIONS, EDITOR_OPERATORS, isEditorMotion, isEditorOperator } from '../../../../lib/editorMotions';

/** Closed-list caret render styles for editor mode. */
export type EditorCaret = 'bar' | 'block' | 'underline';

export interface DiffLine {
  type: 'add' | 'added' | 'remove' | 'removed' | 'context' | 'unchanged';
  content: string;
  lineNumber?: number;
}

export interface CodeViewerAction {
  label: string;
  event?: EventKey;
  navigatesTo?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export interface CodeViewerFile {
  label: string;
  code: string;
  language?: CodeLanguage;
}

export interface CodeBlockProps extends A11yProps {
  /** The code content to display */
  code?: string;
  /** Programming language for syntax highlighting (any Prism id; loaded on demand if not pre-registered) */
  language?: string;
  /** Show the copy button */
  showCopyButton?: boolean;
  /** Show the language badge */
  showLanguageBadge?: boolean;
  /** Maximum height before scrolling */
  maxHeight?: string | number;
  /** Enable brace-based code folding of multi-line `{}`/`[]` blocks (default: true). */
  foldable?: boolean;
  /** Additional CSS classes */
  className?: string;
  /**
   * When true, render an editable surface that composes a transparent `Textarea`
   * over a Prism-highlighted overlay. The overlay re-tokenizes on each keystroke
   * (driven from a local mirror of the textarea value), so users see syntax-highlighted
   * code while still being able to type. Folding is skipped in editable mode.
   *
   * History: GAP-51 first-cut shipped plain (no-highlighting) editable text;
   * GAP-77 (2026-04-12) added the Prism overlay layer.
   *
   * Default: false (existing read-only behavior unchanged).
   */
  editable?: boolean;
  /**
   * GAP-51: called with the new code on every keystroke when `editable === true`.
   * Consumers should debounce + parse downstream — `CodeBlock` does not.
   */
  onChange?: (code: string) => void;
  /**
   * GAP-80: line-level error/warning highlights. Map of 1-based line number
   * → severity. Paints a colored background on each line: error = red,
   * warning = yellow. Honored by the editable overlay and (GAP-84) by
   * viewer mode's non-diff highlight; pass undefined (default) to disable.
   * The consumer is responsible for computing the path → line map from the
   * schema + validation results.
   */
  errorLines?: Map<number, 'error' | 'warning'>;
  /** Lines to mark and keep in view (1-based, inclusive): the code of the step a running program just took. */
  highlightLines?: { start: number; end: number };
  // ── Viewer props (absorbed from CodeViewer / DocCodeBlock) ────────────────
  /** Title shown in the toolbar */
  title?: string;
  /** Diff or plain-code display mode */
  mode?: CodeViewerMode;
  /** Pre-computed diff lines */
  diff?: readonly DiffLine[];
  /** Old source text — generates diff when combined with newValue */
  oldValue?: string;
  /** New source text — generates diff when combined with oldValue */
  newValue?: string;
  /** Show line numbers in code / diff mode */
  showLineNumbers?: boolean;
  /** Enable word-wrap in code / diff mode */
  wordWrap?: boolean;
  /** Multiple files shown as tabs */
  files?: readonly CodeViewerFile[];
  /**
   * Show the program in these natural languages as tabs, translating on the
   * fly. Only meaningful for `language` 'lolo' / 'orb'; ignored otherwise.
   *
   * Fewer than two entries renders exactly as without the prop. `editable`
   * wins: editing a translation is not a thing, so the English source is
   * shown and this is ignored.
   */
  naturalLanguages?: readonly LanguageCode[];
  /** Action badges in the toolbar */
  actions?: readonly CodeViewerAction[];
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
  /** Show copy button (viewer alias for showCopyButton) */
  showCopy?: boolean;
  /**
   * Stable identity for the keyboard router / plugin host to target this editor.
   * Unset = this instance never receives capability events.
   * @tier presentation
   */
  editorId?: string;
  /**
   * Declarative bus emit fired when this editor gains focus.
   * @tier presentation
   * @notification
   */
  onEditorFocus?: EventEmit<{ editorId: string }>;
  /**
   * Declarative bus emit fired when this editor loses focus.
   * @tier presentation
   * @notification
   */
  onEditorBlur?: EventEmit<{ editorId: string }>;
  /**
   * Declarative bus listen: move the cursor per the vim-style motion vocabulary.
   * @tier presentation
   */
  onMotion?: EventListen<{ editorId: string; motion: EditorMotion; count: number }>;
  /**
   * Declarative bus listen: apply a text operator over a motion's range.
   * @tier presentation
   */
  onOperate?: EventListen<{ editorId: string; operator: EditorOperator; motion: EditorMotion; count: number }>;
  /**
   * Declarative bus listen: insert literal text at the cursor.
   * @tier presentation
   */
  onInsertText?: EventListen<{ editorId: string; text: string }>;
  /**
   * Declarative bus listen: switch editor mode and caret style.
   * @tier presentation
   */
  onSetMode?: EventListen<{ editorId: string; mode: string; caret: EditorCaret; keys?: string[] }>;
  /**
   * Emits UI:{onKey} with the keystroke for each key the latest SET_MODE for
   * this editor listed, and keeps it out of the text. No capture without it.
   * @tier presentation
   */
  onKey?: EventEmit<{ editorId: string; key: string; code: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; repeat: boolean }>;
  /**
   * Motion vocabulary this editor accepts. Default: the full `EditorMotion` set.
   * @tier presentation
   */
  motions?: readonly EditorMotion[];
  /**
   * Operator vocabulary this editor accepts. Default: the full `EditorOperator` set.
   * @tier presentation
   */
  operators?: readonly EditorOperator[];
  /**
   * Editable only: answers the caret's valid continuations after a keystroke (and on
   * Ctrl-Space); they show under the editor and Tab or a click inserts one.
   * @tier presentation
   */
  completions?: CodeCompletionProvider;
  /**
   * Editable only: model-assisted editing. Asked after a pause (and on Ctrl-Space) for a
   * completion at the caret, shown as ghost text; on ⌘/Ctrl-. for fixes, listed under the
   * editor. Tab accepts the next, ⌘/Ctrl-Enter accepts all, Escape dismisses.
   * @tier presentation
   */
  assist?: CodeAssistProvider;
  /**
   * Editable only: how many problems the host knows the code has (some, like a parse
   * error, have no line to mark). With `assist`, the editor offers to fix them.
   * @tier presentation
   */
  problems?: number;
  /**
   * Editable only: problems located in the code (1-based line/column in characters,
   * `endColumn` just past the last one), each underlined exactly — red wavy for an
   * error, amber for a warning, dotted where the position is approximate. The
   * message of the one under the caret shows below the editor.
   * @tier presentation
   */
  diagnostics?: readonly CodeDiagnostic[];
  /**
   * Editable only: go to definition. Whether the identifier (a dotted path is one)
   * leads somewhere; with Cmd/Ctrl held the one under the pointer is underlined
   * when it does. Comments and strings never qualify.
   */
  definitionAt?: (identifier: string) => boolean;
  /** Editable only: Cmd/Ctrl+click, or Cmd/Ctrl+Enter at the caret, on an identifier `definitionAt` accepts. */
  onGoToDefinition?: (identifier: string) => void;
  /**
   * The code `diagnostics` were computed on. When the editor's text has moved on,
   * each range is carried over the edit; a range the edit touches is dropped until
   * the code is checked again. Absent: they describe the current text.
   * @tier presentation
   */
  diagnosticsCode?: string;
  /**
   * Editable only: number the lines in a gutter (lines with errors in red). Default on.
   * @tier presentation
   */
  lineNumbers?: boolean;
}

// ── Diff helpers ─────────────────────────────────────────────────────────────

function generateDiff(oldVal: string, newVal: string): DiffLine[] {
  return computeLineDiff(oldVal, newVal).map((line) => ({
    type: line.type,
    content: line.content,
    lineNumber: line.afterLineNumber ?? line.beforeLineNumber,
  }));
}

const DIFF_STYLES: Record<DiffLine['type'], { bg: string; prefix: string; text: string }> = {
  add:       { bg: 'bg-success/10', prefix: '+', text: 'text-success' },
  added:     { bg: 'bg-success/10', prefix: '+', text: 'text-success' },
  remove:    { bg: 'bg-error/10',   prefix: '-', text: 'text-error' },
  removed:   { bg: 'bg-error/10',   prefix: '-', text: 'text-error' },
  context:   { bg: '',              prefix: ' ', text: 'text-foreground' },
  unchanged: { bg: '',              prefix: ' ', text: 'text-foreground' },
};
const DIFF_STYLE_FALLBACK: { bg: string; prefix: string; text: string } = { bg: '', prefix: ' ', text: 'text-foreground' };

// Stable lineProps function (never changes, safe for memoized element)
const LINE_PROPS_FN = (n: number): React.HTMLProps<HTMLElement> => ({ 'data-line': String(n - 1) } as React.HTMLProps<HTMLElement>);
const HIDDEN_LINE_NUMBERS: React.CSSProperties = { display: 'none' };

/**
 * Tokenization capacity bound (VS Code's largeFileOptimizations precedent).
 * One SyntaxHighlighter render is a single uninterruptible function call —
 * Prism + per-line element creation is ~linear in code size, so a multi-MB
 * document costs seconds PER RENDER PASS and, multiplied by StrictMode/dev
 * double renders, wedges the main thread for minutes (architect-shell hang,
 * 2026-09-03: a 2.8MB resolved-IR schema). Above this bound the code renders
 * as plain text — same layout, fonts, scrolling, editing, and copy; dropped:
 * token colors, per-line error backgrounds, and fold gutters (all need
 * per-line DOM).
 */
export const HIGHLIGHT_CAPACITY_BYTES = 512 * 1024;

/** Lines per laid-out chunk of an over-capacity document. */
export const PLAIN_CODE_CHUNK_LINES = 400;

/**
 * An over-capacity document as fixed-size line chunks with `content-visibility: auto`: the browser
 * skips layout and paint for offscreen chunks (a single multi-MB text node cost ~10s of layout),
 * while every line stays in the DOM for find-in-page, selection and copy. The wrapper keeps the
 * widest line's width so horizontal scroll does not depend on which chunks are on screen.
 */
function PlainCodeChunks({ code, style }: { code: string; style: React.CSSProperties }): React.ReactElement {
  const { chunks, widest } = useMemo(() => {
    const lines = code.split('\n');
    const out: Array<{ text: string; lines: number }> = [];
    for (let i = 0; i < lines.length; i += PLAIN_CODE_CHUNK_LINES) {
      const slice = lines.slice(i, i + PLAIN_CODE_CHUNK_LINES);
      out.push({ text: slice.join('\n'), lines: slice.length });
    }
    return { chunks: out, widest: lines.reduce((w, l) => Math.max(w, l.length), 0) };
  }, [code]);
  return (
    <Box style={{ ...style, minWidth: `max(100%, ${widest}ch)` }}>
      {chunks.map((chunk, i) => (
        <Box
          key={i}
          data-code-chunk={i}
          style={{ contentVisibility: 'auto', containIntrinsicBlockSize: `auto ${chunk.lines}lh` }}
        >
          {chunk.text}
        </Box>
      ))}
    </Box>
  );
}

/**
 * What the editable overlay paints for `value`. A textarea ending in a newline
 * shows an empty last line; a block element drops a trailing newline. Painting a
 * space after it keeps both the same height, or the overlay scrolls one line short
 * of the caret at the bottom of the file.
 */
export function overlayText(value: string): string {
  return value === '' || value.endsWith('\n') ? `${value} ` : value;
}

/** Loads the Prism grammar for `language` on demand; returns readiness so the
 *  highlight re-renders once the lazy chunk arrives. */
function useLanguageReady(language: string): boolean {
  const [ready, setReady] = useState(() => isLanguageRegistered(language));
  useEffect(() => {
    if (isLanguageRegistered(language)) {
      if (!ready) setReady(true);
      return;
    }
    let active = true;
    loadPrismLanguage(language).then(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [language]);
  return ready;
}

// ── Shared SyntaxHighlighter machinery ────────────────────────────────────
// Everything below is used by all three render branches (standard / editable
// / viewer, viewer covering both its non-diff and diff sub-cases) so the
// tokenizer, style resolution, and lineProps behavior are defined exactly
// once — GAP-84: viewer mode used to skip this machinery entirely and render
// plain `<Typography>` rows with no Prism pass.

/** Shared monospace font stack for every SyntaxHighlighter-backed code
 *  surface in this file. */
const MONO_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Courier New", "IBM Plex Sans Arabic", "Noto Sans Arabic", monospace';

/** Resolve the AVL-aligned Prism style sheet for a language id — `orb`/`lolo`
 *  get their token-class overrides, everything else uses the base VS Code
 *  Dark+ theme. Module-scope constants, so callers get a stable reference. */
function resolveHighlightStyle(prism: Prism | undefined, lang: string, scheme: SyntaxScheme): Record<string, React.CSSProperties> {
  if (prism === undefined) return PLAIN_STYLES[scheme];
  const styles = schemeStyles(prism, scheme);
  if (lang === 'orb' || lang === 'lolo') return styles[lang];
  return styles.base;
}

/** The `code[class*="language-"]` foreground color a style sheet defines —
 *  used as the plain-text color for the >HIGHLIGHT_CAPACITY_BYTES fallback
 *  so that path still respects the resolved theme instead of a hardcoded gray. */
function plainCodeColorOf(style: Record<string, React.CSSProperties>): string {
  return (style['code[class*="language-"]']?.color as string | undefined) ?? '#d4d4d4';
}

/**
 * Builds a SyntaxHighlighter `lineProps` callback: every line gets `data-line`
 * (selection/scroll code keys off it) plus `extraClassName` when given; a
 * line with a GAP-80 severity in `errorLines` additionally gets the
 * error/warning background. Shared by the editable overlay and viewer's
 * non-diff highlight so `errorLines` behaves identically in either context.
 */
function buildLineProps(
  errorLines: Map<number, 'error' | 'warning'> | undefined,
  extraClassName?: string,
  highlight?: { start: number; end: number },
): (lineNumber: number) => React.HTMLProps<HTMLElement> {
  return (lineNumber: number): React.HTMLProps<HTMLElement> => {
    const highlighted = highlight !== undefined && lineNumber >= highlight.start && lineNumber <= highlight.end;
    const base = {
      'data-line': String(lineNumber - 1),
      ...(extraClassName ? { className: extraClassName } : {}),
      ...(highlighted
        ? {
            'data-highlighted': 'true',
            style: { display: 'block', backgroundColor: 'rgba(96, 165, 250, 0.18)', boxShadow: 'inset 3px 0 0 #60a5fa' },
          }
        : {}),
    } as React.HTMLProps<HTMLElement>;
    const severity = errorLines?.get(lineNumber);
    if (!severity) return base;
    return {
      ...base,
      style: {
        display: 'block',
        backgroundColor: severity === 'error'
          ? 'rgba(248, 113, 113, 0.18)'  // red-400 @ 18%
          : 'rgba(251, 191, 36, 0.18)',  // amber-400 @ 18%
        borderLeft: `3px solid ${severity === 'error' ? '#ef4444' : '#f59e0b'}`,
        paddingLeft: '0.5rem',
        marginLeft: '-0.5rem',
      },
    } as React.HTMLProps<HTMLElement>;
  };
}

/** Line-number gutter style for viewer-mode SyntaxHighlighter instances
 *  (the standard/editable branches instead hide the gutter and derive
 *  `data-line` only — viewer mode wants the numbers actually visible). */
const VIEWER_LINE_NUMBER_STYLE: React.CSSProperties = {
  minWidth: '2.5em',
  paddingRight: '1rem',
  textAlign: 'right',
  userSelect: 'none',
  opacity: 0.5,
  fontVariantNumeric: 'tabular-nums',
};
const VIEWER_LINE_NUMBER_STYLE_RTL: React.CSSProperties = {
  minWidth: '2.5em',
  paddingRight: 0,
  paddingLeft: '1rem',
  textAlign: 'left',
  userSelect: 'none',
  opacity: 0.5,
  fontVariantNumeric: 'tabular-nums',
};

/**
 * English → native rendering of the displayed program. Only `.lolo` and
 * `.orb` carry a vocabulary; every other language passes through, as does a
 * `.orb` string that does not parse (`translateOrb` degrades to "translate
 * nothing" rather than throwing).
 */
function translateProgram(source: string, language: string, lang: LanguageCode): string {
  if (lang === 'en') return source;
  if (language === 'lolo') return translateLolo(source, lang);
  if (language === 'orb') {
    const translated = translateOrb(source, lang);
    return typeof translated === 'string' ? translated : source;
  }
  return source;
}

export const CodeBlock = React.memo<CodeBlockProps>(
  ({
    code: rawCode,
    language = 'text',
    showCopyButton = true,
    showLanguageBadge = true,
    maxHeight = '60vh',
    foldable: foldableProp,
    className,
    editable = false,
    onChange,
    errorLines,
    highlightLines,
    completions,
    assist: assistProvider,
    problems,
    diagnostics,
    definitionAt,
    onGoToDefinition,
    diagnosticsCode,
    lineNumbers,
    // viewer props
    title,
    mode = 'code',
    diff: propDiff,
    oldValue,
    newValue,
    showLineNumbers = false,
    wordWrap = false,
    files,
    naturalLanguages,
    actions,
    isLoading = false,
    error,
    showCopy,
    // editor capability surface — P1 wires these
    editorId,
    onEditorFocus = 'EDITOR_FOCUS',
    onEditorBlur = 'EDITOR_BLUR',
    onMotion = 'MOTION',
    onOperate = 'OPERATE',
    onInsertText = 'INSERT_TEXT',
    onSetMode = 'SET_MODE',
    onKey,
    motions = [
      'left',
      'right',
      'up',
      'down',
      'word-forward',
      'word-back',
      'word-end',
      'line-start',
      'line-end',
      'first-nonblank',
      'doc-start',
      'doc-end',
      'paragraph-forward',
      'paragraph-back',
      'line',
      'selection',
      'match-bracket',
    ],
    operators = [
      'delete',
      'yank',
      'change',
      'put',
      'put-before',
      'undo',
      'redo',
      'join',
      'toggle-case',
      'indent',
      'dedent',
      'replace',
    ],
    ...a11yRest
  }) => {
    // `motions`/`operators` document the vocabulary this instance accepts;
    // enforcement lives at the emitting plugin, not here (P1 E3).
    void motions; void operators;
    const englishCode = typeof rawCode === 'string' ? rawCode : String(rawCode ?? '');

    // ── Natural-language tabs (opt-in) ────────────────────────────────────
    // Fewer than two languages is today's rendering byte for byte, and
    // `editable` wins over the prop rather than throwing.
    const naturalTabs = !editable && naturalLanguages && naturalLanguages.length > 1
      ? naturalLanguages
      : undefined;
    const { locale: pageLocale } = useTranslate();
    const [naturalLanguage, setNaturalLanguage] = useState<LanguageCode>(
      () => naturalTabs?.find((lang) => lang === pageLocale) ?? naturalTabs?.[0] ?? 'en',
    );
    const activeNaturalLanguage: LanguageCode = naturalTabs?.includes(naturalLanguage) === true
      ? naturalLanguage
      : (naturalTabs?.[0] ?? 'en');
    const codeDir: 'ltr' | 'rtl' = naturalTabs && getVocabulary(activeNaturalLanguage).meta.rtl ? 'rtl' : 'ltr';
    // One translation per (source, language), kept across tab switches — a
    // re-render, or coming back to a tab, must never re-run the renderer.
    const translationCache = useMemo(() => new Map<string, string>(), [englishCode, files]);
    const translateFor = useCallback(
      (source: string, sourceLanguage: string, cacheKey: string): string => {
        if (activeNaturalLanguage === 'en') return source;
        const key = `${cacheKey}|${sourceLanguage}|${activeNaturalLanguage}`;
        const hit = translationCache.get(key);
        if (hit !== undefined) return hit;
        const translated = translateProgram(source, sourceLanguage, activeNaturalLanguage);
        translationCache.set(key, translated);
        return translated;
      },
      [translationCache, activeNaturalLanguage],
    );
    const code = translateFor(englishCode, language, 'code');
    // Code stays LTR even in Arabic: bidi mirrors brackets and floats each
    // line's leading `(` to the right edge, which destroys s-expression and
    // indentation structure. Only the tab chrome flips.
    const naturalTabItems: TabItem[] | undefined = naturalTabs?.map((lang) => ({
      id: `lang-${lang}`,
      label: getVocabulary(lang).meta.name,
      content: null,
    }));
    const naturalTabStrip = naturalTabs && naturalTabItems ? (
      <Box
        className="border-b border-border"
        dir={getVocabulary(activeNaturalLanguage).meta.rtl ? 'rtl' : 'ltr'}
        data-testid="codeblock-language-tabs"
      >
        <Tabs
          tabs={naturalTabItems}
          activeTab={`lang-${activeNaturalLanguage}`}
          onTabChange={(id) => {
            const next = naturalTabs.find((lang) => `lang-${lang}` === id);
            if (next) setNaturalLanguage(next);
          }}
        />
      </Box>
    ) : null;

    const prism = usePrism();
    const activeStyle = resolveHighlightStyle(prism, language, 'dark');
    const overCapacity = code.length > HIGHLIGHT_CAPACITY_BYTES;
    const plainCodeColor = plainCodeColorOf(activeStyle);
    const eventBus = useEventBus();
    const { t } = useTranslate();
    const resolvedMode = useScopedMode();
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const viewerScrollRef = useRef<HTMLDivElement | null>(null);
    const codeRef = useRef<HTMLDivElement | null>(null);
    const savedScrollLeftRef = useRef<number>(0);
    const [copied, setCopied] = useState(false);

    // ── Viewer-mode state ─────────────────────────────────────────────────────
    const [wrap, setWrap] = useState(wordWrap);
    const [activeFileIndex, setActiveFileIndex] = useState(0);

    const activeFile = files?.[activeFileIndex];
    const activeLanguage: string = activeFile?.language ?? language;
    const activeCode = activeFile
      ? translateFor(activeFile.code, activeLanguage, `file-${activeFileIndex}`)
      : code;
    // Single readiness check covers all three branches: `activeLanguage`
    // equals `language` whenever `files` isn't used (standard/editable), and
    // resolves the selected file's own grammar when it is (viewer).
    const languageReady = useLanguageReady(activeLanguage);
    // The viewer sits on the theme surface; the standard and editable blocks paint their own dark box.
    const viewerStyle = resolveHighlightStyle(prism, activeLanguage, resolvedMode);
    const viewerPlainCodeColor = plainCodeColorOf(viewerStyle);

    const diffLines = useMemo(() => {
      if (propDiff && propDiff.length > 0) return propDiff;
      if (mode === 'diff' && oldValue !== undefined && newValue !== undefined) {
        return generateDiff(oldValue, newValue);
      }
      return null;
    }, [propDiff, mode, oldValue, newValue]);

    // An empty collection is unset: generated wrappers forward `files: []` / `diff: []` defaults.
    const isViewerMode = !!(title || (files && files.length > 0) || (showLineNumbers && !editable) || diffLines || mode === 'diff' || actions);
    const effectiveCopy = showCopy ?? showCopyButton;

    // ── Editable mode (GAP-77): Prism overlay under transparent textarea ──
    // `editableValue` mirrors the textarea contents so the overlay re-renders
    // on each keystroke. Textarea stays uncontrolled (defaultValue + key) to
    // avoid cursor jumps caused by parent debounce + re-stringify round trips.
    // `lastPropCodeRef` distinguishes "user typed" (overlay updates only) from
    // "parent gave us a new code prop" (re-mount textarea + reset overlay).
    const [editableValue, setEditableValue] = useState(code);
    const [editableTextareaKey, setEditableTextareaKey] = useState(0);
    const lastPropCodeRef = useRef(code);
    const editableTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    // The highlighted text under the textarea: its token spans say what a position is (comment, string, …).
    const highlightLayerRef = useRef<HTMLDivElement | null>(null);
    const [definitionHover, setDefinitionHover] = useState<CodeIdentifier | null>(null);
    const definitionAtOffset = useCallback((code: string, offset: number): CodeIdentifier | null => {
      if (!definitionAt) return null;
      const id = identifierAt(code, offset);
      if (!id) return null;
      const layer = highlightLayerRef.current;
      if (layer && /\b(comment|string)\b/.test(tokenClassAt(layer, id.start))) return null;
      return definitionAt(id.text) ? id : null;
    }, [definitionAt]);
    const editableOverlayRef = useRef<HTMLDivElement | null>(null);
    // SV4-4: the block/underline caret only ever renders while focused.
    const [isFocused, setIsFocused] = useState(false);
    // SV4-1: the caret BEFORE the current keydown is processed — captured on
    // keydown (not derivable from React state, which only updates after the
    // browser applies the keystroke) so `recordKeystroke` can snapshot the
    // pre-edit caret for the undo stack. Edits with no preceding keydown
    // (e.g. a context-menu paste) fall back to the last known value.
    const prevCaretRef = useRef(0);
    const [caretIndex, setCaretIndex] = useState(0);
    const caretMirrorRef = useRef<HTMLDivElement | null>(null);
    const caretMarkerRef = useRef<HTMLSpanElement | null>(null);
    const [caretGeometry, setCaretGeometry] = useState<{ top: number; left: number; lineHeight: number } | null>(null);

    useEffect(() => {
      if (code !== lastPropCodeRef.current) {
        lastPropCodeRef.current = code;
        setEditableValue(code);
        setEditableTextareaKey((k) => k + 1);
      }
    }, [code]);

    const editableGutterRef = useRef<HTMLDivElement | null>(null);
    // Bumped on scroll so layers positioned outside the scrolled overlay re-measure.
    const [scrollTick, setScrollTick] = useState(0);
    const handleEditableScroll = useCallback(() => {
      const ta = editableTextareaRef.current;
      const ov = editableOverlayRef.current;
      if (ta && ov) {
        ov.scrollTop = ta.scrollTop;
        ov.scrollLeft = ta.scrollLeft;
      }
      if (ta && editableGutterRef.current) editableGutterRef.current.scrollTop = ta.scrollTop;
      setScrollTick((n) => n + 1);
    }, []);

    // The ONE change path: a keystroke and a plugin-driven capability edit
    // (useEditorCapabilities' `applyChange`) both flow through here, so both
    // hit `lastPropCodeRef`/`setEditableValue`/`onChange` identically.
    // `origin` only matters upstream (undo coalescing); it changes nothing here.
    const handleEditableChange = useCallback((v: string, _origin: 'keystroke' | 'capability') => {
      // Mark known so the parent echoing `v` back doesn't remount us.
      lastPropCodeRef.current = v;
      setEditableValue(v);
      const ta = editableTextareaRef.current;
      // Keeps caretIndex live after a capability edit too (MOTION/OPERATE/
      // INSERT_TEXT already moved `ta.selectionStart` by the time this runs).
      if (ta) setCaretIndex(caretOf(ta));
      onChange?.(v);
    }, [onChange]);

    const { caretMode, recordKeystroke, undo, redo, capturedKeys } = useEditorCapabilities({
      editorId: editable ? editorId : undefined,
      textareaRef: editableTextareaRef,
      events: { onMotion, onOperate, onInsertText, onSetMode },
      focused: isFocused,
      applyChange: handleEditableChange,
      onCaret: setCaretIndex,
    });

    // A completion is an edit like a keystroke: recorded for undo, then the one change path.
    const applyCompletionEdit = useCallback((next: string, caret: number) => {
      const ta = editableTextareaRef.current;
      if (!ta) return;
      recordKeystroke(ta.value, ta.selectionStart, next);
      ta.value = next;
      ta.setSelectionRange(caret, caret);
      handleEditableChange(next, 'keystroke');
    }, [recordKeystroke, handleEditableChange]);

    const completion = useCodeCompletion(editable ? completions : undefined, editableTextareaRef, applyCompletionEdit);
    // A list the typed prefix has narrowed is the exact answer; an empty-prefix list is only a menu.
    const keywordListNarrowed = completion.isNarrowed;
    const askOnPause = useCallback(() => !keywordListNarrowed(), [keywordListNarrowed]);
    const assist = useCodeAssist(editable ? assistProvider : undefined, editableTextareaRef, applyCompletionEdit, askOnPause);
    const problemCount = problems ?? errorLines?.size ?? 0;
    const diagnosticRangesNow = useMemo((): DiagnosticRange[] => {
      if (!editable || !diagnostics || diagnostics.length === 0) return [];
      const basis = diagnosticsCode ?? editableValue;
      return remapRanges(basis, editableValue, diagnosticRanges(basis, diagnostics));
    }, [editable, diagnostics, diagnosticsCode, editableValue]);
    const diagnosticUnderlines = useMemo(
      () => (diagnosticRangesNow.length > 0 ? underlineSegments(editableValue, diagnosticRangesNow) : []),
      [diagnosticRangesNow, editableValue],
    );
    const diagnosticHere = diagnosticAt(diagnosticRangesNow, caretIndex);
    const showGutter = editable && lineNumbers !== false;
    const lineCount = editableValue.split('\n').length;
    const gutterWidth = showGutter ? String(lineCount).length * 8 + 20 : 0;
    const errorLineSet = useMemo(() => {
      const set = new Set<number>(errorLines ? [...errorLines.keys()] : []);
      for (const r of diagnosticRangesNow) {
        if (r.severity === 'error') set.add(editableValue.slice(0, r.from).split('\n').length);
      }
      return set;
    }, [errorLines, diagnosticRangesNow, editableValue]);
    const ghost = assist.atCaret ? assist.suggestions[0] : undefined;
    const keyword = completion.offer ? completion.offer.result.candidates[completion.selected] : undefined;
    // What shows at the caret: the model's completion, else the rest of the highlighted keyword.
    const inline = ghost
      ? { at: ghost.from, text: ghost.text }
      : completion.offer && keyword
        ? {
            at: completion.offer.offset,
            text: keyword.label.startsWith(completion.offer.result.prefix) ? keyword.label.slice(completion.offer.result.prefix.length) : '',
          }
        : undefined;
    const ghostLines = inline ? inline.text.split('\n') : [];
    const listed = ghost ? assist.suggestions.slice(1) : assist.suggestions;
    const ghostAnchorRef = useRef<HTMLDivElement | null>(null);
    const [anchor, setAnchor] = useState({ top: 0, left: 0, scrollTop: 0, scrollLeft: 0, height: 0 });
    useLayoutEffect(() => {
      const a = ghostAnchorRef.current;
      const ov = editableOverlayRef.current;
      if (a && ov) setAnchor({ top: a.offsetTop, left: a.offsetLeft, scrollTop: ov.scrollTop, scrollLeft: ov.scrollLeft, height: ov.clientHeight });
    }, [inline?.at, inline?.text, editableValue, scrollTick]);
    // A completion from the model wins Tab over the language's keyword list.
    useEffect(() => {
      if (ghost) completion.dismiss();
    }, [ghost, completion.dismiss]);

    const handleEditableKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const ta = editableTextareaRef.current;
        if (ta) prevCaretRef.current = ta.selectionStart;
        if (onKey && editorId && (capturedKeys.has(e.key) || capturedKeys.has(keyChord(e)))) {
          e.preventDefault();
          eventBus.emit(`UI:${onKey}`, { editorId, key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, repeat: e.repeat } satisfies EditorKeyEvent);
          return;
        }
        if (assist.onKeyDown(e)) return;
        if (completion.onKeyDown(e)) return;
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;
        if (e.key === 'Enter' && ta && onGoToDefinition) {
          const id = definitionAtOffset(ta.value, ta.selectionStart);
          if (id) {
            e.preventDefault();
            onGoToDefinition(id.text);
            return;
          }
        }
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          redo();
        }
      },
      [undo, redo, completion, assist, onGoToDefinition, definitionAtOffset, onKey, editorId, capturedKeys, eventBus],
    );

    const showBlockCaret = isFocused && caretMode !== 'bar';

    // SV4-4: measure the caret's pixel position via the standard
    // textarea-caret technique (a hidden mirror div that copies the
    // textarea's computed box/font/wrap so wrapped lines and tabs measure
    // correctly — jsdom has no layout, so this is a no-op there beyond
    // building the mirror's DOM).
    useLayoutEffect(() => {
      if (!showBlockCaret) return;
      const ta = editableTextareaRef.current;
      const mirror = caretMirrorRef.current;
      const marker = caretMarkerRef.current;
      if (!ta || !mirror || !marker) return;
      const computed = window.getComputedStyle(ta);
      const MIRRORED_PROPS = [
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'letter-spacing',
        'line-height',
        'padding-top',
        'padding-right',
        'padding-bottom',
        'padding-left',
        'border-top-width',
        'border-right-width',
        'border-bottom-width',
        'border-left-width',
        'box-sizing',
        'width',
        'white-space',
        'word-break',
        'overflow-wrap',
        'tab-size',
      ] as const;
      for (const prop of MIRRORED_PROPS) {
        mirror.style.setProperty(prop, computed.getPropertyValue(prop));
      }
      const lineHeight = parseFloat(computed.getPropertyValue('line-height'));
      setCaretGeometry({
        top: marker.offsetTop,
        left: marker.offsetLeft,
        lineHeight: Number.isFinite(lineHeight) ? lineHeight : 0,
      });
    }, [showBlockCaret, editableValue, caretIndex]);

    // GAP-80: line-level error highlights (editable overlay). Memoized so
    // identity is stable across renders when `errorLines` hasn't changed.
    const errorLineProps = useMemo(() => buildLineProps(errorLines), [errorLines]);
    // Viewer-mode non-diff highlight: same severity behavior as above, plus
    // the per-row padding/hover chrome the old hand-rolled `<Typography>`
    // rows carried.
    const highlightStart = highlightLines?.start;
    const highlightEnd = highlightLines?.end;
    const highlightRange = useMemo(
      () => (highlightStart !== undefined && highlightEnd !== undefined ? { start: highlightStart, end: highlightEnd } : undefined),
      [highlightStart, highlightEnd],
    );
    const viewerLineProps = useMemo(
      () => buildLineProps(errorLines, 'px-4 py-0.5 hover:bg-muted/50', highlightRange),
      [errorLines, highlightRange],
    );
    const standardLineProps = useMemo(
      () => (highlightRange === undefined ? LINE_PROPS_FN : buildLineProps(undefined, undefined, highlightRange)),
      [highlightRange],
    );

    // ── Fold state ──
    // Folding is brace-based (language-agnostic): any language with multi-line
    // `{}`/`[]` blocks gets collapse/expand gutters by default. Languages with
    // no such blocks yield zero fold regions, so this is a no-op for them.
    const isFoldable = foldableProp ?? true;
    const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());

    const foldRegions = useMemo(
      () => (isFoldable && !overCapacity ? computeFoldRegions(code) : []),
      [code, isFoldable, overCapacity],
    );
    const foldStartMap = useMemo(() => {
      const m = new Map<number, FoldRegion>();
      for (const r of foldRegions) m.set(r.start, r);
      return m;
    }, [foldRegions]);

    const hiddenLines = useMemo(() => {
      const h = new Set<number>();
      for (const r of foldRegions) {
        if (!collapsed.has(r.start)) continue;
        for (let i = r.start + 1; i <= r.end; i++) h.add(i);
      }
      return h;
    }, [foldRegions, collapsed]);

    // Keep refs current so DOM click handlers can read latest state
    const collapsedRef = useRef(collapsed);
    collapsedRef.current = collapsed;
    const foldStartMapRef = useRef(foldStartMap);
    foldStartMapRef.current = foldStartMap;
    const hiddenLinesRef = useRef(hiddenLines);
    hiddenLinesRef.current = hiddenLines;

    const toggleFold = useCallback((lineNum: number) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(lineNum)) next.delete(lineNum);
        else next.add(lineNum);
        return next;
      });
    }, []);
    const toggleFoldRef = useRef(toggleFold);
    toggleFoldRef.current = toggleFold;

    useEffect(() => { setCollapsed(new Set()); }, [code]);

    // ── Memoized editable overlay highlight ──
    // Same discipline as the read-only element below: tokenizing is O(code)
    // and re-runs on EVERY render when built inline, so a parent that
    // re-renders steadily (polling badge, SSE state) against a large schema
    // queues highlight passes faster than they finish and wedges the main
    // thread. Only a keystroke (editableValue) or grammar/style change may
    // re-tokenize.
    const editableOverCapacity = editableValue.length > HIGHLIGHT_CAPACITY_BYTES;
    const editableHighlightedElement = useMemo(
      () =>
        editableOverCapacity || prism === undefined ? (
          <div
            style={{
              padding: '1rem',
              margin: 0,
              whiteSpace: 'pre',
              minWidth: '100%',
              color: plainCodeColor,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Courier New", monospace',
              fontSize: '13px',
              lineHeight: '1.5',
            }}
          >
            {overlayText(editableValue)}
          </div>
        ) : (
        <prism.SyntaxHighlighter
          PreTag="div"
          renderer={renderWithTokenTypes}
          language={language}
          style={activeStyle}
          wrapLines={errorLines && errorLines.size > 0}
          lineProps={errorLineProps}
          customStyle={{
            backgroundColor: 'transparent',
            borderRadius: 0,
            padding: '1rem',
            margin: 0,
            whiteSpace: 'pre',
            minWidth: '100%',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Courier New", monospace',
            fontSize: '13px',
            lineHeight: '1.5',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Courier New", monospace',
              fontSize: '13px',
              lineHeight: '1.5',
            },
          }}
        >
          {overlayText(editableValue)}
        </prism.SyntaxHighlighter>
        ),
      [editableValue, editableOverCapacity, plainCodeColor, language, activeStyle, errorLines, errorLineProps, languageReady, prism],
    );

    // Keep the highlighted range in the middle of whichever scroller is showing.
    const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    useEffect(() => {
      if (highlightRange === undefined) return;
      const host = viewerScrollRef.current ?? scrollRef.current;
      const first = host?.querySelector<HTMLElement>(`[data-line="${highlightRange.start - 1}"]`);
      const last = host?.querySelector<HTMLElement>(`[data-line="${highlightRange.end - 1}"]`) ?? first;
      if (!host || !first || !last) return;
      const hostBox = host.getBoundingClientRect();
      const top = first.getBoundingClientRect().top;
      const bottom = last.getBoundingClientRect().bottom;
      const target = host.scrollTop + (top + bottom) / 2 - (hostBox.top + hostBox.height / 2);
      host.scrollTo({ top: Math.max(0, target), behavior: reduceMotion ? 'auto' : 'smooth' });
    }, [highlightRange, reduceMotion, languageReady, prism, activeCode, code]);

    // ── Memoized highlight (never re-tokenizes on fold toggle) ──
    // showLineNumbers + showInlineLineNumbers=false gives proper data-line
    // without rendering inline numbers. lineNumberContainerStyle hides the gutter.
    const highlightedElement = useMemo(
      () =>
        overCapacity || prism === undefined ? (
          <PlainCodeChunks
            code={code}
            style={{
              margin: 0,
              whiteSpace: 'pre',
              color: plainCodeColor,
            }}
          />
        ) : (
        <prism.SyntaxHighlighter
          PreTag="div"
          language={language}
          style={activeStyle}
          wrapLines
          showLineNumbers
          showInlineLineNumbers={false}
          lineNumberContainerStyle={HIDDEN_LINE_NUMBERS}
          lineProps={standardLineProps}
          customStyle={{
            backgroundColor: 'transparent',
            borderRadius: 0,
            padding: 0,
            margin: 0,
            whiteSpace: 'pre',
            minWidth: '100%',
          }}
        >
          {code}
        </prism.SyntaxHighlighter>
        ),
      [code, overCapacity, plainCodeColor, language, activeStyle, languageReady, standardLineProps, prism],
    );

    // ── Memoized viewer-mode highlight (non-diff) ──
    // GAP-84: this used to be `activeCode.split('\n')` mapped straight into
    // `<Typography>` rows with no Prism pass at all. Same SyntaxHighlighter
    // machinery as the two branches above — `showLineNumbers` and `wrap` are
    // honored through its own `showLineNumbers`/`wrapLongLines` props instead
    // of a hand-rolled number column, and `viewerLineProps` carries GAP-80
    // severity highlighting into viewer mode for the first time.
    const viewerOverCapacity = activeCode.length > HIGHLIGHT_CAPACITY_BYTES;
    const viewerHighlightedElement = useMemo(
      () =>
        viewerOverCapacity || prism === undefined ? (
          <PlainCodeChunks
            code={activeCode}
            style={{
              margin: 0,
              padding: '0.125rem 1rem',
              whiteSpace: wrap ? 'pre-wrap' : 'pre',
              wordBreak: wrap ? 'break-all' : 'normal',
              color: viewerPlainCodeColor,
              fontFamily: MONO_FONT_FAMILY,
              fontSize: '12px',
              lineHeight: '1.6',
            }}
          />
        ) : (
        <prism.SyntaxHighlighter
          PreTag="div"
          language={activeLanguage}
          style={viewerStyle}
          wrapLines
          wrapLongLines={wrap}
          showLineNumbers
          showInlineLineNumbers={showLineNumbers}
          {...(showLineNumbers ? {} : { lineNumberContainerStyle: HIDDEN_LINE_NUMBERS })}
          lineNumberStyle={codeDir === 'rtl' ? VIEWER_LINE_NUMBER_STYLE_RTL : VIEWER_LINE_NUMBER_STYLE}
          lineProps={viewerLineProps}
          renderer={codeDir === 'rtl' ? renderRtlCode : undefined}
          customStyle={{
            backgroundColor: 'transparent',
            borderRadius: 0,
            padding: '0.25rem 0',
            margin: 0,
            whiteSpace: wrap ? 'pre-wrap' : 'pre',
            wordBreak: wrap ? 'break-all' : 'normal',
            fontFamily: MONO_FONT_FAMILY,
            fontSize: '12px',
            lineHeight: '1.6',
            direction: codeDir,
            textAlign: 'start',
          }}
          codeTagProps={{ style: { fontFamily: MONO_FONT_FAMILY, fontSize: '12px', lineHeight: '1.6', direction: codeDir, textAlign: 'start' } }}
        >
          {activeCode}
        </prism.SyntaxHighlighter>
        ),
      [activeCode, viewerOverCapacity, viewerPlainCodeColor, activeLanguage, viewerStyle, wrap, showLineNumbers, viewerLineProps, languageReady, codeDir, prism],
    );

    // ── Memoized diff-mode row highlighting ──
    // react-syntax-highlighter tokenizes its whole `children` string as one
    // unit, so a single call can't hand back independently-styled
    // +/-/context row backgrounds AND a leading prefix glyph that stays
    // outside the tokenized span (`lineProps` sets element attributes, not
    // children) — that chrome lives in this component's own JSX
    // (`DIFF_STYLES`), not Prism's. So each diff row gets its own
    // SyntaxHighlighter instance, tokenizing only that row's content; the
    // surrounding HStack/Typography/prefix markup is unchanged. Acceptable
    // for diff rows specifically (typically short) and still capacity-gated
    // like every other branch in this file.
    const diffOverCapacity = useMemo(
      () => !!diffLines && diffLines.reduce((n, l) => n + l.content.length + 1, 0) > HIGHLIGHT_CAPACITY_BYTES,
      [diffLines],
    );
    const diffRowElements = useMemo(() => {
      if (!diffLines) return null;
      return diffLines.map((line, idx) => {
        const style = DIFF_STYLES[line.type] ?? DIFF_STYLE_FALLBACK;
        return (
          <HStack key={idx} gap="none" align="start" className={cn(style.bg, 'px-4 py-0.5')}>
            {showLineNumbers && (
              <Typography
                variant="caption"
                color="secondary"
                className="w-8 text-right mr-3 select-none tabular-nums flex-shrink-0"
              >
                {line.lineNumber ?? ''}
              </Typography>
            )}
            <Typography
              variant="caption"
              className={cn('font-mono flex-1 min-w-0', style.text, wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')}
            >
              <Box as="span" className="select-none opacity-50 mr-2">{style.prefix}</Box>
              {diffOverCapacity || prism === undefined ? (
                line.content || ' '
              ) : (
                <prism.SyntaxHighlighter
                  PreTag="span"
                  CodeTag="span"
                  language={activeLanguage}
                  style={viewerStyle}
                  customStyle={{
                    display: 'inline',
                    background: 'transparent',
                    padding: 0,
                    margin: 0,
                    whiteSpace: wrap ? 'pre-wrap' : 'pre',
                    wordBreak: wrap ? 'break-all' : 'normal',
                    fontFamily: 'inherit',
                    fontSize: 'inherit',
                    lineHeight: 'inherit',
                  }}
                  codeTagProps={{
                    style: {
                      whiteSpace: wrap ? 'pre-wrap' : 'pre',
                      fontFamily: 'inherit',
                      fontSize: 'inherit',
                    },
                  }}
                >
                  {line.content || ' '}
                </prism.SyntaxHighlighter>
              )}
            </Typography>
          </HStack>
        );
      });
    }, [diffLines, showLineNumbers, wrap, diffOverCapacity, activeLanguage, viewerStyle, languageReady, prism]);

    // ── DOM-level fold UI (no re-tokenization, just style + element injection) ──
    useLayoutEffect(() => {
      const container = codeRef.current;
      if (!container) return;

      // Clean previous fold UI
      container.querySelectorAll('.fold-toggle, .fold-summary').forEach((el) => el.remove());

      // Reset all line styles
      const lineEls = container.querySelectorAll<HTMLElement>('[data-line]');
      if (!isFoldable || foldRegions.length === 0) {
        lineEls.forEach((el) => { el.style.display = ''; el.style.position = ''; el.style.paddingLeft = ''; });
        return;
      }

      // Uniform left padding on ALL lines for aligned fold gutter
      lineEls.forEach((el) => {
        const num = parseInt(el.getAttribute('data-line') ?? '-1', 10);

        if (hiddenLines.has(num)) {
          el.style.display = 'none';
          return;
        }

        el.style.display = '';
        el.style.position = 'relative';
        el.style.paddingLeft = '1.2em';

        const region = foldStartMap.get(num);
        if (!region) return;

        const isCollapsed = collapsed.has(num);

        // Fold toggle — positioned in the left padding area
        const toggle = document.createElement('span');
        toggle.className = 'fold-toggle';
        toggle.textContent = isCollapsed ? '▶' : '▼';
        toggle.style.cssText =
          'position:absolute;left:0;top:0;width:1.2em;text-align:center;' +
          'cursor:pointer;color:#858585;font-size:10px;user-select:none;' +
          'line-height:inherit;height:100%';
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleFoldRef.current(num);
        });
        el.insertBefore(toggle, el.firstChild);

        // Fold summary for collapsed regions
        if (isCollapsed) {
          const summary = document.createElement('span');
          summary.className = 'fold-summary';
          summary.style.cssText = 'color:#858585;font-style:italic';
          const count = region.end - region.start - 1;
          summary.textContent = ` ... ${count} line${count !== 1 ? 's' : ''} ${region.closeBracket}`;
          el.appendChild(summary);
        }
      });
    }, [collapsed, hiddenLines, foldStartMap, foldRegions, isFoldable]);

    // Save scrollLeft before updates
    useLayoutEffect(() => {
      const el = scrollRef.current;
      return () => { if (el) savedScrollLeftRef.current = el.scrollLeft; };
    }, [language, code]);

    // Restore scrollLeft after updates
    useLayoutEffect(() => {
      const el = scrollRef.current;
      if (el) el.scrollLeft = savedScrollLeftRef.current;
    }, [language, code]);

    // Native scroll listener to keep position updated
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const handle = () => { savedScrollLeftRef.current = el.scrollLeft; };
      el.addEventListener('scroll', handle, { passive: true });
      return () => el.removeEventListener('scroll', handle);
    }, [language, code]);

    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(activeCode);
        setCopied(true);
        eventBus.emit('UI:COPY_CODE', { language: activeLanguage, success: true });
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        log.error('Failed to copy code', { error: err instanceof Error ? err : String(err) });
        eventBus.emit('UI:COPY_CODE', { language: activeLanguage, success: false });
      }
    };

    // Selection-copy: when the selection spans collapsed (folded) lines, the
    // DOM only holds the `… N lines` summary plus the visible lines, so a plain
    // copy loses the folded content. Reconstruct the selected line range from
    // the original `code` (fully expanded) instead. Untouched when the range
    // has no hidden lines, so partial in-line selections copy verbatim.
    const handleSelectionCopy = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
      if (hiddenLinesRef.current.size === 0) return;
      const sel = typeof window !== 'undefined' ? window.getSelection() : null;
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const lineOf = (node: Node | null): number | null => {
        const start = node instanceof HTMLElement ? node : node?.parentElement ?? null;
        const lineEl = start?.closest('[data-line]') as HTMLElement | null;
        if (!lineEl) return null;
        const n = parseInt(lineEl.getAttribute('data-line') ?? '', 10);
        return Number.isNaN(n) ? null : n;
      };
      const range = sel.getRangeAt(0);
      let a = lineOf(range.startContainer);
      let b = lineOf(range.endContainer);
      // Endpoints can land on a container (e.g. select-all) rather than inside a
      // line — fall back to the min/max line the selection actually intersects.
      if (a === null || b === null) {
        const container = codeRef.current;
        if (!container) return;
        let min = Infinity, max = -Infinity;
        container.querySelectorAll('[data-line]').forEach((el) => {
          if (!sel.containsNode(el, true)) return;
          const n = parseInt(el.getAttribute('data-line') ?? '', 10);
          if (!Number.isNaN(n)) { min = Math.min(min, n); max = Math.max(max, n); }
        });
        if (min === Infinity) return;
        a = a ?? min;
        b = b ?? max;
      }
      if (a > b) [a, b] = [b, a];
      // A folded region is represented by its (visible) start line plus the
      // `… N lines` summary; the body lines are hidden below it. The selection
      // "touches" folded content if it covers a hidden line OR a collapsed
      // start line. When it does, expand the range over every collapsed region
      // it reaches (fixpoint, so nested folds are covered) and emit the
      // original — fully-expanded — slice. Otherwise leave the copy verbatim.
      let touchesFold = false;
      for (let i = a; i <= b; i++) {
        if (hiddenLinesRef.current.has(i) || (foldStartMapRef.current.has(i) && collapsedRef.current.has(i))) {
          touchesFold = true;
          break;
        }
      }
      if (!touchesFold) return;
      // Expand the end over every collapsed region the selection reaches.
      // `b` is non-null here, but reassigning it inside the closure below would
      // widen it back to `number | null` for TS — use a dedicated number local.
      let endLine = b;
      let changed = true;
      while (changed) {
        changed = false;
        foldStartMapRef.current.forEach((region, start) => {
          if (start >= a && start <= endLine && collapsedRef.current.has(start) && region.end > endLine) {
            endLine = region.end;
            changed = true;
          }
        });
      }
      const full = activeCode.split('\n').slice(a, endLine + 1).join('\n');
      e.clipboardData.setData('text/plain', full);
      e.preventDefault();
    }, [code]);

    // ── Loading / error / empty guards ───────────────────────────────────────
    if (isLoading) {
      return <LoadingState message={t('common.loading')} className={className} />;
    }
    if (error) {
      return <ErrorState title={t('display.codeViewerError')} message={error.message} className={className} />;
    }
    if (isViewerMode && !activeCode && !diffLines) {
      return <EmptyState icon={CodeIcon} title={t('display.noCode')} description={t('codeBlock.noCode')} className={className} />;
    }

    // ── Viewer mode (title / multi-file / diff / showLineNumbers) ─────────────
    if (isViewerMode) {
      const tabItems: TabItem[] | undefined = files?.map((file, idx) => ({
        id: `file-${idx}`,
        label: file.label,
        content: null,
      }));

      return (
        <Card {...domPassthrough(a11yRest)} className={cn('overflow-hidden flex flex-col', className)}>
          <Box className="flex flex-col flex-1 min-h-0">
            {naturalTabStrip}
            {tabItems && tabItems.length > 1 && (
              <Box className="border-b border-border">
                <Tabs
                  tabs={tabItems}
                  activeTab={`file-${activeFileIndex}`}
                  onTabChange={(id) => {
                    const idx = parseInt(id.replace('file-', ''), 10);
                    setActiveFileIndex(idx);
                  }}
                />
              </Box>
            )}
            <HStack
              gap="sm"
              align="center"
              justify="between"
              className="px-4 py-2 border-b border-border bg-muted/30"
            >
              <HStack gap="sm" align="center">
                <Icon icon={mode === 'diff' ? FileText : CodeIcon} size="sm" className="text-muted-foreground" />
                {title && (
                  <Typography variant="small" weight="medium" className="truncate">
                    {title}
                  </Typography>
                )}
                {activeLanguage && activeLanguage !== 'text' && (
                  <Badge variant="default">{activeLanguage}</Badge>
                )}
              </HStack>
              <HStack gap="xs" align="center">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={WrapText}
                  aria-label={t('aria.wrapLines')}
                  aria-pressed={wrap}
                  onClick={() => setWrap(!wrap)}
                  className={cn(wrap && 'text-primary')}
                />
                {effectiveCopy && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={copied ? Check : Copy}
                    aria-label={t('aria.copyCode')}
                    onClick={handleCopy}
                    className={cn(copied && 'text-success')}
                  />
                )}
                {actions?.map((action, idx) => (
                  <Badge
                    key={idx}
                    variant="default"
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => {
                      if (action.event) eventBus.emit(`UI:${action.event}`, {});
                    }}
                  >
                    {action.label}
                  </Badge>
                ))}
              </HStack>
            </HStack>
            <Box ref={viewerScrollRef} className="overflow-auto min-h-0 bg-muted/20" style={{ maxHeight }} dir={codeDir} role="region" tabIndex={0} aria-label={title ?? t('codeBlock.region')}>
              {diffLines ? (
                <div style={{ display: 'flex', flexDirection: 'column' }} className="font-mono text-xs">
                  {diffRowElements}
                </div>
              ) : (
                <div className="font-mono text-xs">{viewerHighlightedElement}</div>
              )}
            </Box>
          </Box>
        </Card>
      );
    }

    // ── Standard PrismLight code block (original behavior) ────────────────────
    // A copy button alone floats over the code box; only a language badge earns a header bar.
    const hasHeader = showLanguageBadge;
    const copyButton = effectiveCopy ? (
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        className={`opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground hover:text-foreground${hasHeader ? '' : ' absolute top-2 end-2 z-10'}`}
        aria-label={t('common.copy')}
      >
        {copied ? (
          <Icon name="check" className="w-4 h-4 text-success" />
        ) : (
          <Icon name="copy" className="w-4 h-4" />
        )}
      </Button>
    ) : null;

    return (
      <Box {...domPassthrough(a11yRest)} className={`relative group not-prose ${className || ''}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {hasHeader ? (
          <HStack
            justify="between"
            align="center"
            className="px-3 py-2 bg-[var(--color-card)] rounded-t-container border-b border-border"
            data-testid="code-block-header"
          >
            <Badge variant="default" size="sm">
              {language}
            </Badge>
            {copyButton}
          </HStack>
        ) : copyButton}
        {naturalTabStrip}

        {/* Code content */}
        {editable ? (
          /* GAP-77 / GAP-82 / GAP-83: editable mode = transparent textarea on
             top of a Prism-highlighted SyntaxHighlighter overlay.

             Layout: BOTH children are `position: absolute, inset: 0` so neither
             contributes to flow. The parent Box has `height: 100%` so it fills
             whatever container the consumer provides (the consumer is
             responsible for giving the parent a real height — usually via flex
             column with `minHeight: 0`).

             Stacking: the overlay is FIRST in DOM order so it paints first
             (behind), the textarea is SECOND so it paints second (on top). No
             explicit z-index — DOM order alone determines stacking inside the
             parent's stacking context. The textarea has `color: transparent`
             plus `WebkitTextFillColor: transparent` (Safari) so its glyphs
             never paint, but the caret stays visible via `caretColor`.

             Scroll sync: textarea scrolls naturally; `handleEditableScroll`
             mirrors its scrollTop/scrollLeft onto the overlay div so the
             highlighted spans stay aligned with the textarea content.

             Error highlights (GAP-80): `errorLines` prop accepts a Map of
             1-based line numbers → severity. The overlay's SyntaxHighlighter
             uses `wrapLines` + `lineProps` to paint a colored background on
             those lines. */
          <Box
            style={{
              position: 'relative',
              flex: 1,
              minHeight: 0,
              maxHeight,
              backgroundColor: '#1e1e1e',
              borderRadius: hasHeader ? '0 0 0.5rem 0.5rem' : '0.5rem',
              overflow: 'hidden',
            }}
          >
            {showGutter && (
              <Box
                ref={editableGutterRef}
                aria-hidden
                data-testid="code-editor-gutter"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: gutterWidth,
                  overflow: 'hidden',
                  paddingTop: '1rem',
                  paddingBottom: '1rem',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              >
                {Array.from({ length: lineCount }, (_, i) => {
                  const isError = errorLineSet.has(i + 1);
                  return (
                    <Box
                      key={i}
                      data-error={isError ? 'true' : undefined}
                      style={{
                        height: EDITOR_LINE_PX,
                        paddingRight: 8,
                        textAlign: 'right',
                        fontFamily: MONO_EDITOR_FONT,
                        fontSize: '13px',
                        lineHeight: '1.5',
                        color: isError ? DIAGNOSTIC_ERROR_COLOR : GUTTER_COLOR,
                      }}
                    >
                      {i + 1}
                    </Box>
                  );
                })}
              </Box>
            )}
            <div
              ref={editableOverlayRef}
              aria-hidden
              data-testid="code-editor-overlay"
              style={{
                position: 'absolute',
                top: 0,
                left: gutterWidth,
                width: `calc(100% - ${gutterWidth}px)`,
                height: '100%',
                overflow: 'hidden',
                pointerEvents: 'none',
              }}
            >
              <Box ref={highlightLayerRef} style={{ display: 'contents' }}>
                {editableHighlightedElement}
              </Box>
              {definitionHover && (
                <Box
                  aria-hidden
                  data-testid="code-definition-layer"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    minWidth: '100%',
                    padding: '1rem',
                    margin: 0,
                    whiteSpace: 'pre',
                    color: 'transparent',
                    fontFamily: MONO_EDITOR_FONT,
                    fontSize: '13px',
                    lineHeight: '1.5',
                  }}
                >
                  {editableValue.slice(0, definitionHover.start)}
                  <Box
                    as="span"
                    data-testid="code-definition-link"
                    style={{ textDecorationLine: 'underline', textDecorationColor: 'var(--color-primary)', textUnderlineOffset: '3px' }}
                  >
                    {editableValue.slice(definitionHover.start, definitionHover.end)}
                  </Box>
                </Box>
              )}
              {diagnosticUnderlines.length > 0 && (
                <Box
                  aria-hidden
                  data-testid="code-diagnostics-layer"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    minWidth: '100%',
                    padding: '1rem',
                    margin: 0,
                    whiteSpace: 'pre',
                    color: 'transparent',
                    fontFamily: MONO_EDITOR_FONT,
                    fontSize: '13px',
                    lineHeight: '1.5',
                  }}
                >
                  {diagnosticUnderlines.map((seg, i) => {
                    const mark = seg.range ?? seg.marker;
                    if (!mark) return <React.Fragment key={i}>{seg.text}</React.Fragment>;
                    return (
                      <Box
                        as="span"
                        key={i}
                        data-testid="code-diagnostic"
                        data-severity={mark.severity}
                        data-approximate={String(mark.approximate)}
                        style={{
                          textDecorationLine: 'underline',
                          textDecorationStyle: mark.approximate ? 'dotted' : 'wavy',
                          textDecorationColor: mark.severity === 'error' ? DIAGNOSTIC_ERROR_COLOR : DIAGNOSTIC_WARNING_COLOR,
                          textDecorationThickness: '1.5px',
                          textDecorationSkipInk: 'none',
                          textUnderlineOffset: '3px',
                        }}
                      >
                        {seg.range ? seg.text : '\u00a0'}
                      </Box>
                    );
                  })}
                </Box>
              )}
              {inline && (
                <Box
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    minWidth: '100%',
                    padding: '1rem',
                    margin: 0,
                    whiteSpace: 'pre',
                    color: 'transparent',
                    fontFamily: MONO_EDITOR_FONT,
                    fontSize: '13px',
                    lineHeight: '1.5',
                  }}
                >
                  {editableValue.slice(0, inline.at)}
                  <Box as="span" ref={ghostAnchorRef} />
                  {ghostLines[0] !== '' && (
                    <Box as="span" data-testid="code-assist-ghost" style={{ color: GHOST_COLOR, backgroundColor: '#1e1e1e', fontStyle: 'italic' }}>
                      {ghostLines[0]}
                    </Box>
                  )}
                </Box>
              )}
              {inline && ghostLines.length > 1 && (
                <Box
                  aria-hidden
                  data-testid="code-assist-ghost-rest"
                  style={{
                    position: 'absolute',
                    top: anchor.top + EDITOR_LINE_PX,
                    left: 0,
                    minWidth: '100%',
                    padding: '0 1rem',
                    margin: 0,
                    whiteSpace: 'pre',
                    color: GHOST_COLOR,
                    fontStyle: 'italic',
                    backgroundColor: '#1e1e1e',
                    borderTop: '1px dashed #3c3c3c',
                    borderBottom: '1px dashed #3c3c3c',
                    fontFamily: MONO_EDITOR_FONT,
                    fontSize: '13px',
                    lineHeight: '1.5',
                  }}
                >
                  {ghostLines.slice(1).join('\n')}
                </Box>
              )}
              {/* Block/underline caret render (SET_MODE), SV4-4: only while
                  focused — the plugin re-announces SET_MODE on every
                  EDITOR_FOCUS, and blur resets caretMode to 'bar' (the hook).
                  Position comes from a hidden mirror div that copies the
                  textarea's computed font/padding/width/wrap (the standard
                  textarea-caret technique) so wrapped lines and tabs measure
                  correctly — character-cell `ch`/row math doesn't. */}
              {showBlockCaret && (
                <div
                  ref={caretMirrorRef}
                  aria-hidden
                  data-testid="editor-caret-mirror"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    padding: '1rem',
                    margin: 0,
                    border: 'none',
                    visibility: 'hidden',
                    pointerEvents: 'none',
                  }}
                >
                  {editableValue.slice(0, caretIndex)}
                  <span ref={caretMarkerRef} data-testid="editor-caret-marker">{'​'}</span>
                </div>
              )}
              {showBlockCaret && caretGeometry && (
                <span
                  aria-hidden
                  data-testid="editor-caret"
                  style={{
                    position: 'absolute',
                    top: caretGeometry.top,
                    left: caretGeometry.left,
                    width: '1ch',
                    height: caretMode === 'block' ? caretGeometry.lineHeight || '1.2em' : '2px',
                    backgroundColor: caretMode === 'block' ? 'rgba(230, 230, 230, 0.5)' : undefined,
                    borderBottom: caretMode === 'underline' ? '2px solid #e6e6e6' : undefined,
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
            <Textarea
              key={editableTextareaKey}
              ref={editableTextareaRef}
              defaultValue={code}
              onChange={(e) => {
                const next = e.target.value;
                recordKeystroke(editableValue, prevCaretRef.current, next);
                assist.onEdited(editableValue, next);
                handleEditableChange(next, 'keystroke');
              }}
              onScroll={handleEditableScroll}
              onSelect={(e) => setCaretIndex(caretOf(e.currentTarget))}
              onKeyUp={(e) => {
                setCaretIndex(caretOf(e.currentTarget));
                if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) assist.onCaretMoved(e.currentTarget.selectionStart);
                completion.onKeyUp(e);
                assist.onKeyUp(e);
              }}
              onClick={(e) => {
                setCaretIndex(caretOf(e.currentTarget));
                assist.onCaretMoved(e.currentTarget.selectionStart);
                if ((e.metaKey || e.ctrlKey) && onGoToDefinition) {
                  const id = definitionAtOffset(e.currentTarget.value, e.currentTarget.selectionStart);
                  if (id) onGoToDefinition(id.text);
                }
              }}
              onMouseMove={(e) => {
                if (!definitionAt) return;
                if (!(e.metaKey || e.ctrlKey)) {
                  if (definitionHover) setDefinitionHover(null);
                  return;
                }
                const offset = offsetUnderPointer(e.currentTarget, highlightLayerRef.current, e.clientX, e.clientY);
                const id = offset === null ? null : definitionAtOffset(e.currentTarget.value, offset);
                if (id?.start !== definitionHover?.start || id?.end !== definitionHover?.end) setDefinitionHover(id);
              }}
              onMouseLeave={() => {
                if (definitionHover) setDefinitionHover(null);
              }}
              onKeyDown={handleEditableKeyDown}
              onFocus={() => {
                setIsFocused(true);
                if (editorId) eventBus.emit(`UI:${onEditorFocus}`, { editorId });
              }}
              onBlur={() => {
                setIsFocused(false);
                if (editorId) eventBus.emit(`UI:${onEditorBlur}`, { editorId });
              }}
              spellCheck={false}
              style={{
                position: 'absolute',
                top: 0,
                left: gutterWidth,
                width: `calc(100% - ${gutterWidth}px)`,
                height: '100%',
                padding: '1rem',
                margin: 0,
                border: 'none',
                outline: 'none',
                resize: 'none',
                backgroundColor: 'transparent',
                color: 'transparent',
                caretColor: caretMode === 'block' ? 'transparent' : '#e6e6e6',
                WebkitTextFillColor: 'transparent',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Courier New", monospace',
                fontSize: '13px',
                lineHeight: '1.5',
                whiteSpace: 'pre',
                overflowWrap: 'normal',
                overflow: 'auto',
              }}
            />
            {completion.offer && (
              <Box
                data-testid="code-completions"
                role="listbox"
                className="rounded-container border border-border shadow-elevation-popover"
                style={{
                  position: 'absolute',
                  zIndex: 2,
                  left: gutterWidth + Math.max(0, anchor.left - anchor.scrollLeft),
                  ...(anchor.top - anchor.scrollTop > anchor.height / 2
                    ? { bottom: anchor.height - (anchor.top - anchor.scrollTop) }
                    : { top: anchor.top - anchor.scrollTop + EDITOR_LINE_PX }),
                  maxHeight: '12rem',
                  minWidth: '12rem',
                  overflowY: 'auto',
                  backgroundColor: '#252526',
                }}
              >
                {completion.offer.result.candidates.map((c, i) => (
                  <Box
                    key={c.label}
                    role="option"
                    aria-selected={i === completion.selected}
                    onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
                    onClick={() => completion.accept(c.label)}
                    className="cursor-pointer px-2 py-0.5"
                    style={{ backgroundColor: i === completion.selected ? '#04395e' : undefined }}
                    data-testid={`code-completion-${c.label}`}
                  >
                    <HStack gap="sm" align="center" justify="between">
                      <Typography variant="caption" className="font-mono" style={{ color: '#e6e6e6' }}>{c.label}</Typography>
                      {c.detail && <Typography variant="caption" color="secondary">{c.detail}</Typography>}
                    </HStack>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        ) : (
          <div
            ref={scrollRef}
            onCopy={handleSelectionCopy}
            dir="ltr"
            // Host pages (Docusaurus/Infima) style every inline `code` with a
            // light background + border + padding; inside this dark card that
            // paints a light box behind every token. Strip it for descendants
            // — same resets CodePreviewTabs used to apply locally per call site.
            className="[&_code]:!bg-transparent [&_code]:!p-0 [&_code]:!border-0 [&_code]:!shadow-none [&_span]:!bg-transparent"
            role="region"
            tabIndex={0}
            aria-label={title ?? t('codeBlock.region')}
            style={{
              flex: 1,
              minHeight: 0,
              overflowX: 'auto',
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              maxHeight,
              overscrollBehavior: 'auto',
              touchAction: 'pan-x pan-y',
              contain: 'paint',
              backgroundColor: '#1e1e1e',
              borderRadius: hasHeader ? '0 0 0.5rem 0.5rem' : '0.5rem',
            }}
          >
            <div ref={codeRef} style={{ padding: '1rem' }}>
              {highlightedElement}
            </div>
          </div>
        )}
        {diagnosticHere && (
          <Box className="flex-shrink-0 border-t border-border px-2 py-1" data-testid="code-diagnostic-at-caret">
            <Typography variant="caption" style={{ color: diagnosticHere.severity === 'error' ? DIAGNOSTIC_ERROR_COLOR : DIAGNOSTIC_WARNING_COLOR }}>
              {diagnosticHere.message}
            </Typography>
          </Box>
        )}
        {editable && assistProvider && (assist.asking || assist.suggestions.length > 0 || assist.note || problemCount > 0) && (
          <Box className="flex-shrink-0 border-t border-border px-2 py-1.5" data-testid="code-assist-bar">
            <HStack gap="sm" align="center" wrap>
              {assist.asking && (
                <Typography variant="caption" color="secondary">
                  {assist.asking === 'fix' ? t('codeAssist.findingFixes') : t('codeAssist.thinking')}
                </Typography>
              )}
              {assist.suggestions.length > 0 && (
                <>
                  <Badge variant="info" size="sm">{t('codeAssist.suggested', { count: assist.suggestions.length })}</Badge>
                  <Typography variant="caption" color="secondary">{t('codeAssist.keys')}</Typography>
                  {listed.length > 0 && (
                    <Button size="sm" variant="primary" onClick={assist.acceptAll} data-testid="code-assist-accept-all">
                      {t('codeAssist.acceptAll')}
                    </Button>
                  )}
                </>
              )}
              {!assist.asking && assist.suggestions.length === 0 && problemCount > 0 && (
                <Button size="sm" variant="secondary" onClick={() => assist.request('fix', 'explicit')} data-testid="code-assist-request-fix">
                  {t('codeAssist.suggestFixes', { count: problemCount })}
                </Button>
              )}
              {assist.note && <Typography variant="caption" color="secondary">{assist.note}</Typography>}
            </HStack>
            {listed.map((s, i) => (
              <Box
                key={`${s.from}-${s.to}-${i}`}
                role="button"
                tabIndex={0}
                onClick={() => assist.accept(s)}
                className="mt-1 cursor-pointer rounded-interactive border border-border px-2 py-1 hover:bg-muted/50"
                data-testid={`code-assist-fix-${i}`}
              >
                <Typography variant="caption" color="secondary">
                  {t('codeAssist.line', { line: editableValue.slice(0, s.from).split('\n').length })}{s.why ? ` · ${s.why}` : ''}
                </Typography>
                {s.to > s.from && (
                  <Typography variant="caption" className="block whitespace-pre font-mono" style={{ color: '#f48771' }}>
                    {editableValue.slice(s.from, s.to).replace(/^/gm, '− ')}
                  </Typography>
                )}
                {s.text !== '' && (
                  <Typography variant="caption" className="block whitespace-pre font-mono" style={{ color: '#89d185' }}>
                    {s.text.replace(/^\n/, '').replace(/^/gm, '+ ')}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  },
  (prev, next) =>
    prev.language === next.language &&
    prev.code === next.code &&
    prev.showCopyButton === next.showCopyButton &&
    prev.showCopy === next.showCopy &&
    prev.maxHeight === next.maxHeight &&
    prev.foldable === next.foldable &&
    prev.editable === next.editable &&
    prev.onChange === next.onChange &&
    prev.completions === next.completions &&
    prev.assist === next.assist &&
    prev.problems === next.problems &&
    prev.diagnostics === next.diagnostics &&
    prev.definitionAt === next.definitionAt &&
    prev.onGoToDefinition === next.onGoToDefinition &&
    prev.diagnosticsCode === next.diagnosticsCode &&
    prev.lineNumbers === next.lineNumbers &&
    prev.errorLines === next.errorLines &&
    prev.highlightLines?.start === next.highlightLines?.start &&
    prev.highlightLines?.end === next.highlightLines?.end &&
    prev.mode === next.mode &&
    prev.title === next.title &&
    prev.diff === next.diff &&
    prev.files === next.files &&
    prev.naturalLanguages === next.naturalLanguages &&
    prev.actions === next.actions &&
    prev.isLoading === next.isLoading &&
    prev.error === next.error &&
    prev.editorId === next.editorId &&
    prev.onEditorFocus === next.onEditorFocus &&
    prev.onEditorBlur === next.onEditorBlur &&
    prev.onMotion === next.onMotion &&
    prev.onOperate === next.onOperate &&
    prev.onInsertText === next.onInsertText &&
    prev.onSetMode === next.onSetMode &&
    prev.onKey === next.onKey &&
    prev.motions === next.motions &&
    prev.operators === next.operators,
);

CodeBlock.displayName = 'CodeBlock';
