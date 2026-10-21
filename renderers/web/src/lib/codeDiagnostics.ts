/**
 * Diagnostics for an editable CodeBlock, located the way compilers report them:
 * 1-based line and column counted in characters, `endColumn` just past the last
 * character. They become ranges of the editor's string (UTF-16 offsets) that the
 * editor underlines.
 */
import { singleChange } from './codeAssist';

export interface CodeDiagnostic {
  line: number;
  /** Absent: the line's text (indentation excluded). */
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning';
  message: string;
  /** The position is an enclosing construct's, not the offending token's. */
  approximate?: boolean;
}

export interface DiagnosticRange {
  from: number;
  to: number;
  severity: CodeDiagnostic['severity'];
  message: string;
  approximate: boolean;
}

const utf16 = (chars: readonly string[]) => chars.join('').length;

export function diagnosticRanges(code: string, diagnostics: readonly CodeDiagnostic[]): DiagnosticRange[] {
  const lines = code.split('\n');
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  const out: DiagnosticRange[] = [];
  for (const d of diagnostics) {
    const i = d.line - 1;
    if (i < 0 || i >= lines.length) continue;
    const chars = Array.from(lines[i]);
    let start: number;
    let end: number;
    if (d.column === undefined) {
      start = chars.findIndex((c) => c !== ' ' && c !== '\t');
      if (start < 0) start = chars.length;
      end = chars.length;
      while (end > start && (chars[end - 1] === ' ' || chars[end - 1] === '\t')) end--;
    } else {
      start = Math.min(Math.max(d.column - 1, 0), chars.length);
      const sameLine = d.endLine === undefined || d.endLine === d.line;
      end = sameLine && d.endColumn !== undefined ? d.endColumn - 1 : chars.length;
      end = Math.min(Math.max(end, start), chars.length);
      if (end === start && start < chars.length) end = start + 1;
    }
    out.push({
      from: starts[i] + utf16(chars.slice(0, start)),
      to: starts[i] + utf16(chars.slice(0, end)),
      severity: d.severity,
      message: d.message,
      approximate: d.approximate === true,
    });
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

export interface UnderlineSegment {
  text: string;
  /** The diagnostic drawn under this run (errors outrank warnings), if any. */
  range?: DiagnosticRange;
  /** A zero-width diagnostic at `text`'s end (e.g. at a line end). */
  marker?: DiagnosticRange;
}

const rank = (r: DiagnosticRange) => (r.severity === 'error' ? 1 : 0);

export function underlineSegments(code: string, ranges: readonly DiagnosticRange[]): UnderlineSegment[] {
  const cuts = new Set<number>([0, code.length]);
  for (const r of ranges) {
    cuts.add(r.from);
    cuts.add(r.to);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: UnderlineSegment[] = [];
  for (let k = 0; k < points.length; k++) {
    const from = points[k];
    const markers = ranges.filter((r) => r.from === r.to && r.from === from);
    if (markers.length > 0) {
      segments.push({ text: '', marker: [...markers].sort((a, b) => rank(b) - rank(a))[0] });
    }
    const to = points[k + 1];
    if (to === undefined || to === from) continue;
    const covering = ranges.filter((r) => r.from <= from && r.to >= to && r.to > r.from);
    const top = [...covering].sort((a, b) => rank(b) - rank(a))[0];
    segments.push(top ? { text: code.slice(from, to), range: top } : { text: code.slice(from, to) });
  }
  return segments;
}

/** The diagnostic whose range holds the caret (its ends included), errors first. */
export function diagnosticAt(ranges: readonly DiagnosticRange[], caret: number): DiagnosticRange | undefined {
  return [...ranges]
    .filter((r) => r.from <= caret && caret <= r.to)
    .sort((a, b) => rank(b) - rank(a))[0];
}

/**
 * Carry ranges computed on `basis` over to `current`: one edited span separates
 * them; ranges it touches are dropped (they are stale until checked again),
 * ranges after it shift.
 */
export function remapRanges(basis: string, current: string, ranges: readonly DiagnosticRange[]): DiagnosticRange[] {
  const change = singleChange(basis, current);
  if (!change) return [...ranges];
  const delta = change.text.length - (change.to - change.from);
  const out: DiagnosticRange[] = [];
  for (const r of ranges) {
    if (r.to < change.from || (r.to === change.from && r.from < r.to)) out.push(r);
    else if (r.from > change.to || (r.from === change.to && change.to > change.from)) out.push({ ...r, from: r.from + delta, to: r.to + delta });
  }
  return out;
}
