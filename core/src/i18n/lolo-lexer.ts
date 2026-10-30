/**
 * A `.lolo` lexer — the JS-path mirror of `orbital-lolo/src/syntax/lexer.rs`.
 *
 * It exists so the JS path can rewrite a program's VOCABULARY without
 * re-implementing the parser: every token carries its byte span, so a
 * consumer splices replacement text into the original source and every
 * comment, blank line and alignment survives untouched.
 *
 * The character classes are generated from the Rust lexer
 * (`generated/lolo-lexer-tables.ts`); `true`/`false`/`null` are their own kinds.
 *
 * @packageDocumentation
 */

import {
  IDENT_CONTINUE_RANGES,
  IDENT_START_RANGES,
  SIGIL_CONTINUE_RANGES,
  type CodePointRange,
} from '../generated/lolo-lexer-tables.js';

export type LoloTokenKind =
  | 'comment'
  | 'string'
  | 'number'
  | 'identifier'
  | 'literal'
  | 'sigil'
  | 'payload-sigil'
  | 'punct';

export interface LoloToken {
  kind: LoloTokenKind;
  /** Byte-independent (UTF-16 code unit) start offset into the source. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  /**
   * The token's semantic text. For `identifier`/`literal` it is the word
   * itself; for `sigil`/`payload-sigil` it is the name WITHOUT the `@`/`?`
   * prefix; for everything else it is the raw slice.
   */
  text: string;
  /** Offset at which `text` starts (differs from `start` for sigils). */
  textStart: number;
}

function inRanges(ranges: readonly CodePointRange[], source: string, i: number): number {
  const cp = source.codePointAt(i);
  if (cp === undefined) return 0;
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [first, last] = ranges[mid];
    if (cp < first) hi = mid - 1;
    else if (cp > last) lo = mid + 1;
    else return cp > 0xffff ? 2 : 1;
  }
  return 0;
}
const DIGIT = /[0-9]/;
const identStartWidth = (s: string, i: number): number => inRanges(IDENT_START_RANGES, s, i);
const identContinueWidth = (s: string, i: number): number => inRanges(IDENT_CONTINUE_RANGES, s, i);
const sigilWidth = (s: string, i: number): number => inRanges(SIGIL_CONTINUE_RANGES, s, i);

/**
 * Tokenize a `.lolo` source. Never throws: an unterminated string or block
 * comment runs to end-of-input and is returned as that token, because this
 * lexer's callers render source they did not necessarily author (a docs
 * fence, an editor buffer mid-keystroke) and must degrade to "translate
 * nothing" rather than fail.
 */
export function lexLolo(source: string): LoloToken[] {
  const tokens: LoloToken[] = [];
  let i = 0;
  const n = source.length;

  const push = (kind: LoloTokenKind, start: number, end: number, text?: string, textStart?: number): void => {
    tokens.push({
      kind,
      start,
      end,
      text: text ?? source.slice(start, end),
      textStart: textStart ?? start,
    });
  };

  while (i < n) {
    const c = source[i];

    // Whitespace (newlines included — layout is preserved by span splicing).
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }

    // `#= … =#` block comment, `#` line comment.
    if (c === '#') {
      const start = i;
      if (source[i + 1] === '=') {
        const close = source.indexOf('=#', i + 2);
        i = close === -1 ? n : close + 2;
      } else {
        const nl = source.indexOf('\n', i);
        i = nl === -1 ? n : nl;
      }
      push('comment', start, i);
      continue;
    }

    // `;;` line comment.
    if (c === ';' && source[i + 1] === ';') {
      const start = i;
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      push('comment', start, i);
      continue;
    }

    // String literal, with `\`-escapes.
    if (c === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      push('string', start, Math.min(i, n));
      continue;
    }

    // `@(` (inline trait ref) vs `@name` sigil.
    if (c === '@') {
      const start = i;
      i++;
      if (source[i] === '(') {
        i++;
        push('punct', start, i);
        continue;
      }
      const nameStart = i;
      for (let w = sigilWidth(source, i); i < n && w > 0; w = sigilWidth(source, i)) i += w;
      push('sigil', start, i, source.slice(nameStart, i), nameStart);
      continue;
    }

    // `?name` payload sigil, or a bare `?`.
    if (c === '?') {
      const start = i;
      i++;
      if (i < n && identStartWidth(source, i) > 0) {
        const nameStart = i;
        for (let w = sigilWidth(source, i); i < n && w > 0; w = sigilWidth(source, i)) i += w;
        push('payload-sigil', start, i, source.slice(nameStart, i), nameStart);
      } else {
        push('payload-sigil', start, i, '', i);
      }
      continue;
    }

    // Negative number vs `->` / `--` / bare `-` (the subtraction operator).
    if (c === '-') {
      const start = i;
      if (source[i + 1] === '>') {
        i += 2;
        push('punct', start, i);
      } else if (source[i + 1] === '-') {
        i += 2;
        push('punct', start, i);
      } else if (source[i + 1] !== undefined && DIGIT.test(source[i + 1])) {
        i++;
        while (i < n && (DIGIT.test(source[i]) || source[i] === '.')) i++;
        push('number', start, i);
      } else {
        i++;
        push('identifier', start, i);
      }
      continue;
    }

    if (DIGIT.test(c)) {
      const start = i;
      while (i < n && (DIGIT.test(source[i]) || source[i] === '.')) i++;
      push('number', start, i);
      continue;
    }

    // Symbolic operators the Rust lexer emits as Identifier tokens.
    if (c === '=' || c === '!' || c === '<' || c === '>') {
      const start = i;
      i++;
      if (source[i] === '=') i++;
      // A lone `=` / `!` is punctuation (`trait X = …`, `string!`); the
      // two-char forms are operator identifiers.
      const two = i - start === 2;
      push(two ? 'identifier' : 'punct', start, i);
      continue;
    }
    if (c === '+' || c === '*' || c === '/' || c === '%') {
      const start = i;
      i++;
      push('identifier', start, i);
      continue;
    }

    if (identStartWidth(source, i) > 0) {
      const start = i;
      for (let w = identContinueWidth(source, i); i < n && w > 0; w = identContinueWidth(source, i)) i += w;
      const text = source.slice(start, i);
      push(text === 'true' || text === 'false' || text === 'null' ? 'literal' : 'identifier', start, i, text);
      continue;
    }

    // Everything else is punctuation: ( ) [ ] { } : :: , | & . → and any
    // stray character. `::` is emitted as one token, matching the Rust lexer.
    const start = i;
    i++;
    if (c === ':' && source[i] === ':') i++;
    push('punct', start, i);
  }

  return tokens;
}
