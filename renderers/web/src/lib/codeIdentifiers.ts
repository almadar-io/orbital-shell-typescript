/**
 * The identifier at a position in code, for go to definition. A dotted path
 * (`AppShell.traits.AppLayout`) is one identifier: segments of letters, digits
 * and `_`, joined by single dots.
 */

export interface CodeIdentifier {
  text: string;
  /** JavaScript string indexes: `start` inclusive, `end` exclusive. */
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}_]/u;

function isWord(code: string, i: number): boolean {
  return i >= 0 && i < code.length && WORD.test(code[i] ?? '');
}

/** The identifier containing `offset`, or ending at it; null on whitespace or punctuation. */
export function identifierAt(code: string, offset: number): CodeIdentifier | null {
  let at = offset;
  if (!isWord(code, at)) {
    if (!isWord(code, at - 1)) return null;
    at -= 1;
  }
  let start = at;
  for (;;) {
    while (isWord(code, start - 1)) start -= 1;
    if (code[start - 1] === '.' && isWord(code, start - 2)) start -= 1;
    else break;
  }
  let end = at + 1;
  for (;;) {
    while (isWord(code, end)) end += 1;
    if (code[end] === '.' && isWord(code, end + 1)) end += 1;
    else break;
  }
  return { text: code.slice(start, end), start, end };
}
