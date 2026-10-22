/**
 * A `.lolo` lexer — the JS-path mirror of `orbital-lolo/src/lexer.rs`.
 *
 * It exists so the JS path can rewrite a program's VOCABULARY without
 * re-implementing the parser: every token carries its byte span, so a
 * consumer splices replacement text into the original source and every
 * comment, blank line and alignment survives untouched.
 *
 * The character classes below are copied from the Rust lexer rather than
 * re-derived — an identifier continues on `alphanumeric | _ | / | -` (so
 * `render-ui` and `str/upper` are ONE token), a sigil root continues on
 * `alphanumeric | _ | .`, and `true`/`false`/`null` are their own kinds.
 * `is_alphanumeric` there is Unicode, so the `u`-flagged `\p{L}`/`\p{N}`
 * classes here match it for Arabic and Slovenian identifiers.
 *
 * @packageDocumentation
 */

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

const IDENT_START = /[\p{L}_]/u;
const IDENT_CONTINUE = /[\p{L}\p{N}_/-]/u;
const SIGIL_CONTINUE = /[\p{L}\p{N}_.]/u;
const DIGIT = /[0-9]/;

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
      while (i < n && SIGIL_CONTINUE.test(source[i])) i++;
      push('sigil', start, i, source.slice(nameStart, i), nameStart);
      continue;
    }

    // `?name` payload sigil, or a bare `?`.
    if (c === '?') {
      const start = i;
      i++;
      if (i < n && IDENT_START.test(source[i])) {
        const nameStart = i;
        while (i < n && SIGIL_CONTINUE.test(source[i])) i++;
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

    if (IDENT_START.test(c)) {
      const start = i;
      while (i < n && IDENT_CONTINUE.test(source[i])) i++;
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
