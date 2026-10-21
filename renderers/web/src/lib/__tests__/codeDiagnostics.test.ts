/**
 * A diagnostic's position (1-based line/column in characters, `endColumn` just
 * past the last one — what `orb validate` reports) becomes a range of the
 * editor's string, so the underline covers exactly the offending text.
 */
import { describe, expect, it } from 'vitest';
import { diagnosticAt, diagnosticRanges, remapRanges, underlineSegments, type CodeDiagnostic } from '../codeDiagnostics';

const code = 'orbital A {\n    oops\n  (set @entity.title ?name)\n}';
const err = (d: Omit<CodeDiagnostic, 'severity' | 'message'>): CodeDiagnostic => ({ severity: 'error', message: 'm', ...d });
const text = (c: string, r: { from: number; to: number }) => c.slice(r.from, r.to);

describe('diagnosticRanges', () => {
  it('covers exactly the reported span', () => {
    const [r] = diagnosticRanges(code, [err({ line: 2, column: 5, endLine: 2, endColumn: 9 })]);
    expect(text(code, r)).toBe('oops');
    const [f] = diagnosticRanges(code, [err({ line: 3, column: 8, endLine: 3, endColumn: 21 })]);
    expect(text(code, f)).toBe('@entity.title');
  });

  it('control: no diagnostics, no ranges; a line past the end is dropped', () => {
    expect(diagnosticRanges(code, [])).toEqual([]);
    expect(diagnosticRanges(code, [err({ line: 9, column: 1 })])).toEqual([]);
  });

  it('edge: without a column the line’s text is covered, indentation excluded', () => {
    const [r] = diagnosticRanges(code, [err({ line: 3 })]);
    expect(text(code, r)).toBe('(set @entity.title ?name)');
  });

  it('edge: columns count characters, so an astral character before the span does not shift it', () => {
    const c = 'x "😀" @entity.a';
    const [r] = diagnosticRanges(c, [err({ line: 1, column: 7, endColumn: 16 })]);
    expect(text(c, r)).toBe('@entity.a');
  });

  it('edge: a span past the line end is clamped; a zero-width span covers one character', () => {
    const [r] = diagnosticRanges(code, [err({ line: 2, column: 5, endColumn: 99 })]);
    expect(text(code, r)).toBe('oops');
    const [z] = diagnosticRanges(code, [err({ line: 2, column: 5, endColumn: 5 })]);
    expect(text(code, z)).toBe('o');
  });

  it('edge: a position at the very end of a line is kept, zero-width, for a marker', () => {
    const [r] = diagnosticRanges(code, [err({ line: 1, column: 12, endColumn: 12 })]);
    expect(r.from).toBe(r.to);
    expect(r.from).toBe('orbital A {'.length);
  });
});

describe('underlineSegments', () => {
  it('splits the code into plain and underlined runs that join back to the code', () => {
    const ranges = diagnosticRanges(code, [err({ line: 2, column: 5, endColumn: 9 })]);
    const segs = underlineSegments(code, ranges);
    expect(segs.map((s) => s.text).join('')).toBe(code);
    expect(segs.filter((s) => s.range).map((s) => s.text)).toEqual(['oops']);
  });

  it('edge: overlapping ranges become one run each, an error outranking a warning', () => {
    const ranges = diagnosticRanges(code, [
      { line: 3, column: 3, endColumn: 21, severity: 'warning', message: 'w' },
      err({ line: 3, column: 8, endColumn: 21 }),
    ]);
    const segs = underlineSegments(code, ranges).filter((s) => s.range);
    expect(segs.map((s) => [s.text, s.range?.severity])).toEqual([['(set ', 'warning'], ['@entity.title', 'error']]);
  });
});

describe('diagnosticAt', () => {
  const ranges = diagnosticRanges(code, [err({ line: 2, column: 5, endColumn: 9 })]);
  const oops = code.indexOf('oops');

  it('finds the diagnostic under the caret, ends included', () => {
    expect(diagnosticAt(ranges, oops)?.message).toBe('m');
    expect(diagnosticAt(ranges, oops + 4)?.message).toBe('m');
  });

  it('control: a caret elsewhere finds nothing', () => {
    expect(diagnosticAt(ranges, 0)).toBeUndefined();
  });
});

describe('remapRanges', () => {
  const ranges = diagnosticRanges(code, [err({ line: 2, column: 5, endColumn: 9 }), err({ line: 3, column: 8, endColumn: 21 })]);

  it('an edit before a range shifts it; after it, leaves it', () => {
    const typed = code.replace('orbital A {', 'orbital Ab {');
    const next = remapRanges(code, typed, ranges);
    expect(next.map((r) => text(typed, r))).toEqual(['oops', '@entity.title']);
  });

  it('control: no edit, same ranges', () => {
    expect(remapRanges(code, code, ranges)).toEqual(ranges);
  });

  it('edge: an edit inside a range drops it until the code is checked again', () => {
    const typed = code.replace('oops', 'oxps');
    expect(remapRanges(code, typed, ranges).map((r) => text(typed, r))).toEqual(['@entity.title']);
  });
});
