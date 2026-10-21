/**
 * Pure vim-flavored editor motion module. No DOM — `CodeBlock.tsx` drives a
 * real `<textarea>` selection through this (Almadar Studio V4 §14 plan, P1
 * E2); this module only computes offsets and text.
 *
 * Caret convention: an integer offset in `[0, text.length]`, a gap position
 * (matches `textarea.selectionStart`) — except `word-end`, `line-end` and
 * `match-bracket`, which land ON the index of their target character (vim's
 * `e`/`$`/`%` block-cursor convention), so `motionRange` widens those by one
 * to make an operator's range inclusive of that char.
 *
 * `EDITOR_MOTIONS` / `EDITOR_OPERATORS` are the single source of truth for
 * the closed vocabularies — `CodeBlock.tsx`'s `motions`/`operators` prop
 * defaults must list the same members (kept as JSON literals there for the
 * pattern-registry parser; `test/CodeBlock.editable.test.tsx` asserts they
 * stay in sync).
 */

export const EDITOR_MOTIONS = [
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
] as const;

export type EditorMotion = (typeof EDITOR_MOTIONS)[number];

export const EDITOR_OPERATORS = [
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
] as const;

export type EditorOperator = (typeof EDITOR_OPERATORS)[number];

const EDITOR_MOTION_SET: ReadonlySet<string> = new Set(EDITOR_MOTIONS);
const EDITOR_OPERATOR_SET: ReadonlySet<string> = new Set(EDITOR_OPERATORS);

export function isEditorMotion(value: string): value is EditorMotion {
  return EDITOR_MOTION_SET.has(value);
}

export function isEditorOperator(value: string): value is EditorOperator {
  return EDITOR_OPERATOR_SET.has(value);
}

/** Fixed indent unit for the `indent`/`dedent` operators (two spaces). */
export const INDENT_UNIT = '  ';

interface Line {
  start: number;
  /** Index of the line's `\n`, or `text.length` for the last line — never includes the `\n` itself. A trailing `\r` (CRLF) is ordinary line content, never a separator. */
  end: number;
}

interface Word {
  start: number;
  end: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      lines.push({ start, end: i });
      start = i + 1;
    }
  }
  return lines;
}

function lineIndexAt(lines: Line[], pos: number): number {
  for (let i = 0; i < lines.length; i++) {
    if (pos <= lines[i].end) return i;
  }
  return lines.length - 1;
}

/** Vim word = `\w+` (identifier run) or `\S+` (other non-space run); `\s` (incl. `\n`) separates. */
function findWords(text: string): Word[] {
  const words: Word[] = [];
  const re = /\w+|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    words.push({ start: m.index, end: m.index + m[0].length });
  }
  return words;
}

function nextWordStart(text: string, pos: number): number {
  for (const w of findWords(text)) {
    if (w.start > pos) return w.start;
  }
  return text.length;
}

function prevWordStart(text: string, pos: number): number {
  let result = 0;
  for (const w of findWords(text)) {
    if (w.start < pos) result = w.start;
    else break;
  }
  return result;
}

function nextWordEnd(text: string, pos: number): number {
  for (const w of findWords(text)) {
    const lastChar = w.end - 1;
    if (lastChar > pos) return lastChar;
  }
  return text.length > 0 ? text.length - 1 : 0;
}

function firstNonBlank(text: string, line: Line): number {
  let i = line.start;
  while (i < line.end && (text[i] === ' ' || text[i] === '\t')) i++;
  return i;
}

function nextParagraphBoundary(lines: Line[], fromLineIdx: number, textLength: number): number {
  for (let i = fromLineIdx + 1; i < lines.length; i++) {
    if (lines[i].start === lines[i].end) return lines[i].start;
  }
  return textLength;
}

function prevParagraphBoundary(lines: Line[], fromLineIdx: number): number {
  for (let i = fromLineIdx - 1; i >= 0; i--) {
    if (lines[i].start === lines[i].end) return lines[i].start;
  }
  return 0;
}

const BRACKET_PARTNER: Readonly<Record<string, string>> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
};
const OPEN_BRACKETS: ReadonlySet<string> = new Set(['(', '[', '{']);

/** Index of the bracket matching the one at `pos`, or `null` if `pos` isn't a bracket or has no match. */
function matchBracket(text: string, pos: number): number | null {
  const ch = text[pos];
  const partner = ch !== undefined ? BRACKET_PARTNER[ch] : undefined;
  if (partner === undefined) return null;
  let depth = 1;
  if (OPEN_BRACKETS.has(ch)) {
    for (let i = pos + 1; i < text.length; i++) {
      if (text[i] === ch) depth++;
      else if (text[i] === partner) {
        depth--;
        if (depth === 0) return i;
      }
    }
  } else {
    for (let i = pos - 1; i >= 0; i--) {
      if (text[i] === ch) depth++;
      else if (text[i] === partner) {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return null;
}

/** New caret offset after applying `motion` `count` times. `line`/`selection` are range-only — caret is unchanged. */
export function applyMotion(text: string, caret: number, motion: EditorMotion, count: number): number {
  const n = Math.max(1, count);
  const lines = computeLines(text);
  const lineIdx = lineIndexAt(lines, caret);
  const line = lines[lineIdx];

  switch (motion) {
    case 'left':
      return clamp(caret - n, line.start, line.end);
    case 'right':
      return clamp(caret + n, line.start, line.end);
    case 'up': {
      // Sticky column: the target column is fixed from the ORIGINAL caret,
      // not re-derived after each intermediate line (matches vim `nj`).
      const col = caret - line.start;
      const targetIdx = clamp(lineIdx - n, 0, lines.length - 1);
      const target = lines[targetIdx];
      return clamp(target.start + col, target.start, target.end);
    }
    case 'down': {
      const col = caret - line.start;
      const targetIdx = clamp(lineIdx + n, 0, lines.length - 1);
      const target = lines[targetIdx];
      return clamp(target.start + col, target.start, target.end);
    }
    case 'word-forward': {
      let pos = caret;
      for (let i = 0; i < n; i++) pos = nextWordStart(text, pos);
      return pos;
    }
    case 'word-back': {
      let pos = caret;
      for (let i = 0; i < n; i++) pos = prevWordStart(text, pos);
      return pos;
    }
    case 'word-end': {
      let pos = caret;
      for (let i = 0; i < n; i++) pos = nextWordEnd(text, pos);
      return pos;
    }
    case 'line-start':
      return line.start;
    case 'line-end':
      return line.end > line.start ? line.end - 1 : line.start;
    case 'first-nonblank':
      return firstNonBlank(text, line);
    case 'doc-start':
      return 0;
    case 'doc-end':
      return text.length;
    case 'paragraph-forward': {
      let pos = caret;
      for (let i = 0; i < n; i++) {
        pos = nextParagraphBoundary(lines, lineIndexAt(lines, pos), text.length);
      }
      return pos;
    }
    case 'paragraph-back': {
      let pos = caret;
      for (let i = 0; i < n; i++) {
        pos = prevParagraphBoundary(lines, lineIndexAt(lines, pos));
      }
      return pos;
    }
    case 'match-bracket': {
      // Vim `%`: caret-on-a-bracket jumps to its match; otherwise scan
      // forward on the current line to the first bracket and jump to ITS
      // match. No count semantics (matches vim, where a count on `%` means
      // something else entirely — file percentage). No match -> unchanged.
      const chAtCaret = text[caret];
      if (chAtCaret !== undefined && BRACKET_PARTNER[chAtCaret] !== undefined) {
        const target = matchBracket(text, caret);
        return target === null ? caret : target;
      }
      for (let i = caret; i < line.end; i++) {
        if (BRACKET_PARTNER[text[i]] !== undefined) {
          const target = matchBracket(text, i);
          return target === null ? caret : target;
        }
      }
      return caret;
    }
    case 'line':
    case 'selection':
      return caret;
    default: {
      const _exhaustive: never = motion;
      return _exhaustive;
    }
  }
}

/** The `[start, end)` range an operator acts on for `motion`. */
export function motionRange(
  text: string,
  caret: number,
  motion: EditorMotion,
  count: number,
  selection?: [number, number],
): [number, number] {
  if (motion === 'selection') {
    if (!selection) return [caret, caret];
    return [Math.min(selection[0], selection[1]), Math.max(selection[0], selection[1])];
  }

  const lines = computeLines(text);

  if (motion === 'line') {
    const n = Math.max(1, count);
    const startIdx = lineIndexAt(lines, caret);
    const endIdx = clamp(startIdx + n - 1, 0, lines.length - 1);
    const start = lines[startIdx].start;
    const rawEnd = lines[endIdx].end;
    // Include the trailing `\n` when one exists, so `dd` removes the whole line.
    const end = rawEnd < text.length ? rawEnd + 1 : rawEnd;
    return [start, end];
  }

  const newCaret = applyMotion(text, caret, motion, count);
  let start = Math.min(caret, newCaret);
  let end = Math.max(caret, newCaret);

  if ((motion === 'word-end' || motion === 'line-end' || motion === 'match-bracket') && newCaret !== caret) {
    // applyMotion lands ON the target char (either direction, for
    // match-bracket); widen to include it.
    end = Math.min(Math.max(caret, newCaret) + 1, text.length);
  } else if (motion === 'word-forward' && newCaret > caret) {
    // vim `dw`: a word-forward that would cross into the next line stops at
    // the end of the current line instead of swallowing its `\n`.
    const startLine = lineIndexAt(lines, caret);
    const endLine = lineIndexAt(lines, newCaret);
    if (endLine !== startLine) {
      end = lines[startLine].end;
    }
  }

  return [start, end];
}

function toggleCase(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
}

function applyJoin(
  text: string,
  caret: number,
  count: number,
  register: string,
  registerLinewise: boolean,
): ApplyOperatorResult {
  const lines = computeLines(text);
  const startIdx = lineIndexAt(lines, caret);
  const n = Math.max(2, count);
  const endIdx = clamp(startIdx + n - 1, 0, lines.length - 1);
  if (endIdx <= startIdx) {
    return { text, caret, register, registerLinewise };
  }
  const joinCaret = lines[startIdx].end;
  let joined = text.slice(lines[startIdx].start, lines[startIdx].end);
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const raw = text.slice(lines[i].start, lines[i].end);
    joined += ' ' + raw.replace(/^[ \t]+/, '');
  }
  const newText = text.slice(0, lines[startIdx].start) + joined + text.slice(lines[endIdx].end);
  return { text: newText, caret: joinCaret, register, registerLinewise };
}

function applyIndent(
  text: string,
  start: number,
  end: number,
  operator: 'indent' | 'dedent',
  register: string,
  registerLinewise: boolean,
): ApplyOperatorResult {
  const lines = computeLines(text);
  const startLineIdx = lineIndexAt(lines, start);
  const lastTouchedPos = end > start ? end - 1 : start;
  const endLineIdx = lineIndexAt(lines, lastTouchedPos);
  let result = text;
  // Bottom-up so earlier line-start offsets stay valid as later ones shift.
  for (let i = endLineIdx; i >= startLineIdx; i--) {
    const lineStart = lines[i].start;
    if (operator === 'indent') {
      result = result.slice(0, lineStart) + INDENT_UNIT + result.slice(lineStart);
    } else if (result[lineStart] === '\t') {
      result = result.slice(0, lineStart) + result.slice(lineStart + 1);
    } else {
      let removeCount = 0;
      while (removeCount < INDENT_UNIT.length && result[lineStart + removeCount] === ' ') removeCount++;
      result = result.slice(0, lineStart) + result.slice(lineStart + removeCount);
    }
  }
  const newLines = computeLines(result);
  const caret = firstNonBlank(result, newLines[startLineIdx]);
  return { text: result, caret, register, registerLinewise };
}

function applyPut(
  text: string,
  caret: number,
  operator: 'put' | 'put-before',
  register: string,
  registerLinewise: boolean,
  count: number,
): ApplyOperatorResult {
  if (register.length === 0) {
    return { text, caret, register, registerLinewise };
  }
  const content = register.repeat(count);
  const lines = computeLines(text);
  const line = lines[lineIndexAt(lines, caret)];

  if (registerLinewise) {
    if (operator === 'put-before') {
      const insertPos = line.start;
      return {
        text: text.slice(0, insertPos) + content + text.slice(insertPos),
        caret: insertPos,
        register,
        registerLinewise,
      };
    }
    const nextLineIdx = lineIndexAt(lines, caret) + 1;
    if (nextLineIdx < lines.length) {
      const insertPos = lines[nextLineIdx].start;
      return {
        text: text.slice(0, insertPos) + content + text.slice(insertPos),
        caret: insertPos,
        register,
        registerLinewise,
      };
    }
    // No next line (caret is on the last line) -> append at doc end.
    const insertPos = text.length;
    return {
      text: text.slice(0, insertPos) + '\n' + content,
      caret: insertPos + 1,
      register,
      registerLinewise,
    };
  }

  // charwise
  const insertPos =
    operator === 'put-before' ? clamp(caret, 0, text.length) : clamp(caret + 1, line.start, line.end);
  return {
    text: text.slice(0, insertPos) + content + text.slice(insertPos),
    caret: insertPos + content.length - 1,
    register,
    registerLinewise,
  };
}

export interface ApplyOperatorInput {
  text: string;
  /** `textarea.selectionStart` at the time the operator fired — the anchor for caret-based operators (put/put-before/join) that don't act over `range`. */
  caret: number;
  /** The `[start, end)` range from `motionRange` — the anchor for range-based operators (delete/yank/change/toggle-case/indent/dedent/replace). */
  range: [number, number];
  operator: EditorOperator;
  /** The motion paired with this operator. `change` special-cases `line`; delete/yank/change use it to set the returned `registerLinewise`. */
  motion: EditorMotion;
  count: number;
  register: string;
  registerLinewise: boolean;
}

export interface ApplyOperatorResult {
  text: string;
  caret: number;
  register: string;
  registerLinewise: boolean;
}

/** Apply `operator`. `undo`/`redo` never reach here — they're history-stack operations handled by `useEditorCapabilities`. */
export function applyOperator(input: ApplyOperatorInput): ApplyOperatorResult {
  const { text, caret, operator, motion, register, registerLinewise } = input;
  const count = Math.max(1, input.count);
  const start = clamp(input.range[0], 0, text.length);
  const end = clamp(input.range[1], start, text.length);

  switch (operator) {
    case 'yank':
      return { text, caret: start, register: text.slice(start, end), registerLinewise: motion === 'line' };

    case 'delete':
    case 'replace': {
      const removed = text.slice(start, end);
      return {
        text: text.slice(0, start) + text.slice(end),
        caret: start,
        register: removed,
        registerLinewise: motion === 'line',
      };
    }

    case 'change': {
      if (motion === 'line') {
        // Vim `cc`: clears the line content but keeps the trailing `\n` —
        // it does not join with the next line.
        const hasTrailingNewline = end > start && text[end - 1] === '\n';
        const removeEnd = hasTrailingNewline ? end - 1 : end;
        const removed = text.slice(start, removeEnd);
        return {
          text: text.slice(0, start) + text.slice(removeEnd),
          caret: start,
          register: removed,
          registerLinewise: true,
        };
      }
      const removed = text.slice(start, end);
      return {
        text: text.slice(0, start) + text.slice(end),
        caret: start,
        register: removed,
        registerLinewise: false,
      };
    }

    case 'put':
    case 'put-before':
      return applyPut(text, caret, operator, register, registerLinewise, count);

    case 'join':
      return applyJoin(text, caret, count, register, registerLinewise);

    case 'toggle-case': {
      const toggled = toggleCase(text.slice(start, end));
      return { text: text.slice(0, start) + toggled + text.slice(end), caret: end, register, registerLinewise };
    }

    case 'indent':
    case 'dedent':
      return applyIndent(text, start, end, operator, register, registerLinewise);

    case 'undo':
    case 'redo':
      // Handled by the history stack in useEditorCapabilities; never reaches here.
      return { text, caret, register, registerLinewise };

    default: {
      const _exhaustive: never = operator;
      return _exhaustive;
    }
  }
}
