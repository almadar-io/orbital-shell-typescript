/**
 * BufferCodeBlock — CodeBlock's buffer mode. The program owns the text, cursor, modes and every key's
 * meaning; this surface paints them and emits raw input. Nothing here edits text, moves the caret or
 * interprets a key (EXEC-BOUND).
 *
 * Event Contract:
 * - Emits: UI:{onKey} { editorId, key, code, ctrl, alt, shift, meta, repeat } on every keydown
 * - Emits: UI:{onPointerDown} { editorId, row, col }, UI:{onHover} { editorId, row, col }
 * - Emits: UI:EDITOR_FOCUS { editorId }, UI:EDITOR_BLUR { editorId }
 */

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography, useEventBus } from '../../../../core';
import type { EditorKeyEvent } from '../../../../hooks/useKeyboardRouter';
import { useEditorFocus } from '../../../../providers/EditorFocusContext';
import type { CodeBlockProps, CodeCursor, CodeDecoration, CodeSelection, EditorCaret } from './CodeBlock';

const FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Courier New", monospace';
/** 13px × 1.5 — the same line box the editable surface uses. */
const LINE_PX = 19.5;
const PROBE = '0000000000';

const SYNTAX_TONES: Record<string, string> = {
  keyword: 'var(--color-primary)',
  string: 'var(--color-success)',
  comment: 'var(--color-muted-foreground)',
  number: 'var(--color-warning)',
  type: 'var(--color-accent)',
  function: 'var(--color-info)',
  operator: 'var(--color-foreground)',
  punctuation: 'var(--color-muted-foreground)',
  variable: 'var(--color-foreground)',
};

const tint = (token: string, percent: number): string => `color-mix(in srgb, var(${token}) ${percent}%, transparent)`;

const ANNOTATION_TONES: Record<string, string> = {
  search: tint('--color-warning', 40),
  review: tint('--color-primary', 22),
  'review-recent': tint('--color-accent', 35),
  error: tint('--color-error', 25),
  warning: tint('--color-warning', 25),
  info: tint('--color-info', 22),
};

const SELECTION_BG = tint('--color-primary', 35);

const caretStyle = (caret: EditorCaret): React.CSSProperties => {
  if (caret === 'bar') return { boxShadow: 'inset 2px 0 0 var(--color-foreground)' };
  if (caret === 'underline') return { boxShadow: 'inset 0 -2px 0 var(--color-foreground)' };
  return { backgroundColor: 'var(--color-foreground)', color: 'var(--color-background)' };
};

interface Cell {
  ch: string;
  fg?: string;
  bg?: string;
  tones: string[];
  label?: string;
  selected: boolean;
  caret?: EditorCaret;
}

interface Run {
  text: string;
  cell: Cell;
}

const before = (aRow: number, aCol: number, bRow: number, bCol: number): boolean => aRow < bRow || (aRow === bRow && aCol <= bCol);

function runsOf(
  row: number,
  chars: string[],
  decorations: readonly CodeDecoration[],
  selection: CodeSelection | null,
  cursor: CodeCursor,
  caret: EditorCaret,
): { runs: Run[]; lineSelected: boolean } {
  const len = chars.length;
  const cells: Cell[] = chars.map((ch) => ({ ch, tones: [], selected: false }));
  const eol: Cell = { ch: ' ', tones: [], selected: false };
  const cellAt = (i: number): Cell => cells[i] ?? eol;

  for (const d of decorations) {
    const start = row === d.fromRow ? d.fromCol : 0;
    const end = row === d.toRow ? d.toCol : len;
    for (let i = Math.max(0, start); i < Math.min(len, end); i++) {
      const cell = cells[i];
      cell.tones.push(d.tone);
      const fg = SYNTAX_TONES[d.tone];
      const bg = ANNOTATION_TONES[d.tone];
      if (fg !== undefined) cell.fg = fg;
      if (bg !== undefined) cell.bg = bg;
      if (d.label !== undefined) cell.label = d.label;
    }
  }

  let lineSelected = false;
  if (selection !== null) {
    const fromFirst = before(selection.fromRow, selection.fromCol, selection.toRow, selection.toCol);
    const minRow = fromFirst ? selection.fromRow : selection.toRow;
    const minCol = fromFirst ? selection.fromCol : selection.toCol;
    const maxRow = fromFirst ? selection.toRow : selection.fromRow;
    const maxCol = fromFirst ? selection.toCol : selection.fromCol;
    if (row >= minRow && row <= maxRow) {
      if (selection.linewise) {
        lineSelected = true;
        for (const cell of cells) cell.selected = true;
        if (len === 0) eol.selected = true;
      } else {
        const start = row === minRow ? minCol : 0;
        const end = row === maxRow ? maxCol : len;
        for (let i = Math.max(0, start); i <= end && i <= len; i++) cellAt(i).selected = true;
      }
    }
  }

  if (row === cursor.row) cellAt(Math.min(cursor.col, len)).caret = caret;

  const shown = [...cells];
  if (eol.selected || eol.caret !== undefined) shown.push(eol);

  const runs: Run[] = [];
  const keyOf = (c: Cell): string => `${c.fg ?? ''}|${c.bg ?? ''}|${c.tones.join(' ')}|${c.label ?? ''}|${c.selected}`;
  for (const cell of shown) {
    const last = runs[runs.length - 1];
    if (last !== undefined && cell.caret === undefined && last.cell.caret === undefined && keyOf(last.cell) === keyOf(cell)) {
      last.text += cell.ch;
    } else {
      runs.push({ text: cell.ch, cell });
    }
  }
  return { runs, lineSelected };
}

export type BufferCodeBlockProps = CodeBlockProps & { cursor: CodeCursor };

export function BufferCodeBlock({
  code: rawCode,
  maxHeight = '60vh',
  className,
  editorId,
  onEditorFocus = 'EDITOR_FOCUS',
  onEditorBlur = 'EDITOR_BLUR',
  onKey,
  onPointerDown,
  onHover,
  cursor,
  caret = 'block',
  selection = null,
  decorations,
  popover = null,
  lineNumbers,
  relativeLineNumbers = false,
}: BufferCodeBlockProps): React.ReactElement {
  const eventBus = useEventBus();
  const editorFocus = useEditorFocus();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const linesRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const hoverCell = useRef<string>('');
  const [flipped, setFlipped] = useState(false);

  const text = typeof rawCode === 'string' ? rawCode : String(rawCode ?? '');
  const lines = useMemo(() => text.split('\n').map((line) => Array.from(line)), [text]);
  const byRow = useMemo(() => {
    const map = new Map<number, CodeDecoration[]>();
    for (const d of decorations ?? []) {
      for (let r = d.fromRow; r <= d.toRow; r++) {
        const held = map.get(r);
        if (held) held.push(d);
        else map.set(r, [d]);
      }
    }
    return map;
  }, [decorations]);

  const showGutter = lineNumbers !== false;
  const gutterChars = String(lines.length).length;
  const noDecorations: readonly CodeDecoration[] = [];

  const charWidth = useCallback((): number => {
    const probe = probeRef.current;
    return probe ? probe.getBoundingClientRect().width / PROBE.length : 0;
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const top = cursor.row * LINE_PX;
    const height = scroller.clientHeight;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (height > 0 && top + LINE_PX > scroller.scrollTop + height) scroller.scrollTop = top + LINE_PX - height;
    const cw = charWidth();
    const width = scroller.clientWidth;
    if (cw > 0 && width > 0) {
      const left = cursor.col * cw;
      if (left < scroller.scrollLeft) scroller.scrollLeft = left;
      else if (left + cw > scroller.scrollLeft + width) scroller.scrollLeft = left + cw - width;
    }
  }, [cursor.row, cursor.col, charWidth]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const note = popoverRef.current;
    if (!popover || !scroller || !note) {
      setFlipped(false);
      return;
    }
    const height = note.offsetHeight;
    const below = (popover.fromRow + 1) * LINE_PX;
    const noRoomBelow = scroller.clientHeight > 0 && below + height > scroller.scrollTop + scroller.clientHeight;
    const roomAbove = popover.fromRow * LINE_PX - height >= scroller.scrollTop;
    setFlipped(noRoomBelow && roomAbove);
  }, [popover]);

  const cellOf = (e: React.PointerEvent<HTMLDivElement>): { row: number; col: number } => {
    const surface = linesRef.current;
    const rect = surface ? surface.getBoundingClientRect() : { left: 0, top: 0 };
    const last = lines.length - 1;
    const hit = e.target instanceof Element ? e.target.closest('[data-row]') : null;
    const hitRow = hit ? Number(hit.getAttribute('data-row')) : NaN;
    const row = Number.isNaN(hitRow)
      ? Math.min(last, Math.max(0, Math.floor((e.clientY - rect.top) / LINE_PX)))
      : hitRow;
    const cw = charWidth();
    const len = lines[row]?.length ?? 0;
    const col = cw > 0 ? Math.min(len, Math.max(0, Math.floor((e.clientX - rect.left) / cw))) : 0;
    return { row, col };
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.nativeEvent.isComposing || e.key === 'Process') return;
    e.preventDefault();
    if (onKey && editorId) {
      eventBus.emit(`UI:${onKey}`, {
        editorId, key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, repeat: e.repeat,
      } satisfies EditorKeyEvent);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    surfaceRef.current?.focus();
    if (onPointerDown && editorId) eventBus.emit(`UI:${onPointerDown}`, { editorId, ...cellOf(e) });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const cell = cellOf(e);
    const key = `${cell.row}:${cell.col}`;
    if (key === hoverCell.current) return;
    hoverCell.current = key;
    if (onHover && editorId) eventBus.emit(`UI:${onHover}`, { editorId, ...cell });
  };

  const gutterNumber = (row: number): number =>
    relativeLineNumbers && row !== cursor.row ? Math.abs(row - cursor.row) : row + 1;

  return (
    <Box
      ref={surfaceRef}
      data-buffer=""
      role="textbox"
      aria-multiline="true"
      aria-readonly="true"
      tabIndex={0}
      className={className}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => { hoverCell.current = ''; }}
      onFocus={() => {
        if (!editorId) return;
        editorFocus.focus(editorId);
        eventBus.emit(`UI:${onEditorFocus}`, { editorId });
      }}
      onBlur={() => {
        if (!editorId) return;
        editorFocus.blur(editorId);
        eventBus.emit(`UI:${onEditorBlur}`, { editorId });
      }}
      style={{
        outline: 'none',
        backgroundColor: 'var(--color-surface-subtle)',
        color: 'var(--color-foreground)',
        fontFamily: FONT,
        fontSize: '13px',
        lineHeight: `${LINE_PX}px`,
        cursor: 'text',
        userSelect: 'none',
      }}
    >
      <Box ref={scrollRef} data-buffer-scroll="" style={{ display: 'flex', overflow: 'auto', maxHeight, position: 'relative' }}>
        {showGutter && (
          <Box
            aria-hidden="true"
            style={{
              position: 'sticky',
              left: 0,
              flexShrink: 0,
              zIndex: 1,
              boxSizing: 'content-box',
              width: `${gutterChars}ch`,
              padding: '0 1ch',
              textAlign: 'right',
              backgroundColor: 'var(--color-surface-subtle)',
              color: 'var(--color-muted-foreground)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {lines.map((_, row) => (
              <Box
                key={row}
                data-gutter=""
                style={{ height: LINE_PX, color: row === cursor.row ? 'var(--color-foreground)' : undefined }}
              >
                {gutterNumber(row)}
              </Box>
            ))}
          </Box>
        )}
        <Box ref={linesRef} style={{ position: 'relative', flexGrow: 1, minWidth: 0 }}>
          <Box
            as="span"
            ref={probeRef}
            aria-hidden="true"
            data-probe=""
            style={{ position: 'absolute', visibility: 'hidden', whiteSpace: 'pre', pointerEvents: 'none' }}
          >
            {PROBE}
          </Box>
          {lines.map((chars, row) => {
            const { runs, lineSelected } = runsOf(row, chars, byRow.get(row) ?? noDecorations, selection, cursor, caret);
            return (
              <Box
                key={row}
                data-row={row}
                {...(lineSelected ? { 'data-selected-line': '' } : {})}
                style={{ height: LINE_PX, whiteSpace: 'pre', minWidth: 'max-content' }}
              >
                {runs.map((run, i) => (
                  <Box
                    as="span"
                    key={i}
                    {...(run.cell.caret !== undefined ? { 'data-caret': run.cell.caret } : {})}
                    {...(run.cell.selected ? { 'data-selected': '' } : {})}
                    {...(run.cell.tones.length > 0 ? { 'data-tone': run.cell.tones.join(' ') } : {})}
                    {...(run.cell.label !== undefined ? { role: 'group', 'aria-label': run.cell.label } : {})}
                    style={{
                      ...(run.cell.fg !== undefined ? { color: run.cell.fg } : {}),
                      ...(run.cell.bg !== undefined ? { backgroundColor: run.cell.bg } : {}),
                      ...(run.cell.selected ? { backgroundColor: SELECTION_BG } : {}),
                      ...(run.cell.caret !== undefined ? caretStyle(run.cell.caret) : {}),
                    }}
                  >
                    {run.text}
                  </Box>
                ))}
              </Box>
            );
          })}
          {popover && (
            <Box
              ref={popoverRef}
              data-popover=""
              role="note"
              style={{
                position: 'absolute',
                left: `${popover.fromCol}ch`,
                top: flipped ? popover.fromRow * LINE_PX : (popover.fromRow + 1) * LINE_PX,
                transform: flipped ? 'translateY(-100%)' : undefined,
                zIndex: 2,
                maxWidth: '60ch',
                padding: '0.5rem 0.75rem',
                whiteSpace: 'normal',
                pointerEvents: 'none',
                backgroundColor: 'var(--color-card)',
                color: 'var(--color-foreground)',
                border: '1px solid var(--color-border)',
                borderRadius: '0.375rem',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <Typography variant="label">{popover.title}</Typography>
              {popover.sections.map((section, i) => (
                <Box key={i} style={{ marginTop: '0.375rem' }}>
                  <Typography variant="caption" color="muted">{section.heading}</Typography>
                  {section.lines.map((line, j) => (
                    <Typography key={j} variant="body2">{line}</Typography>
                  ))}
                </Box>
              ))}
              {popover.busy && (
                <Box as="span" data-busy="" role="progressbar" aria-busy="true" className="animate-pulse" style={{ color: 'var(--color-muted-foreground)' }}>
                  …
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
