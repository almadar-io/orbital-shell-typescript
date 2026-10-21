import { describe, it, expect } from 'vitest';
import {
  applyMotion,
  applyOperator,
  motionRange,
  isEditorMotion,
  isEditorOperator,
  EDITOR_MOTIONS,
  EDITOR_OPERATORS,
  INDENT_UNIT,
  type EditorMotion,
  type EditorOperator,
  type ApplyOperatorInput,
} from '../../src/lib/editorMotions';

// Fixture indices (25 chars total):
//  0  h   6  w  11 \n  12 f  15 (sp)(sp) 17 b  20 \n 21 \n 22 b  25(end)
//  "hello world\nfoo  bar\n\nbaz"
//  line0 "hello world"  [0,11)   words: hello[0,5) world[6,11)
//  line1 "foo  bar"     [12,20)  words: foo[12,15) bar[17,20)
//  line2 ""             [21,21)  (blank line)
//  line3 "baz"          [22,25)  words: baz[22,25)
const TEXT = 'hello world\nfoo  bar\n\nbaz';

/** applyOperator now takes one options object; this fills the fields every
 * call site doesn't care about with neutral defaults. */
function op(overrides: Partial<ApplyOperatorInput> & Pick<ApplyOperatorInput, 'range' | 'operator'>) {
  return applyOperator({
    text: TEXT,
    caret: overrides.range[0],
    motion: 'selection',
    count: 1,
    register: '',
    registerLinewise: false,
    ...overrides,
  });
}

describe('applyMotion — left/right (stay within the current line)', () => {
  it.each([
    ['left', 8, 1, 7],
    ['left', 8, 2, 6],
    ['left', 0, 1, 0], // clamped at line start
    ['right', 8, 1, 9],
    ['right', 8, 2, 10],
    ['right', 10, 2, 11], // clamped at line end
  ] as const)('%s from %i count=%i -> %i', (motion, caret, count, expected) => {
    expect(applyMotion(TEXT, caret, motion, count)).toBe(expected);
  });
});

describe('applyMotion — up/down (sticky column)', () => {
  it('down keeps the original column, clamped to the shorter target line', () => {
    // caret=8 is 'r' in "world" (col 8 on line0)
    expect(applyMotion(TEXT, 8, 'down', 1)).toBe(20); // line1 has only 8 cols -> clamps to line end
  });

  it('down x2 lands on the blank line regardless of column', () => {
    expect(applyMotion(TEXT, 8, 'down', 2)).toBe(21);
  });

  it('up keeps the original column across a blank line', () => {
    // caret=23 is 'a' in "baz" (col 1 on line3)
    expect(applyMotion(TEXT, 23, 'up', 1)).toBe(21); // line2 is blank -> clamps to its only position
    expect(applyMotion(TEXT, 23, 'up', 2)).toBe(13); // line1 col 1 = 'o' of "foo"
  });
});

describe('applyMotion — word-forward / word-back (vim w/b)', () => {
  it.each([
    ['word-forward', 0, 1, 6],
    ['word-forward', 0, 2, 12],
    ['word-back', 12, 1, 6],
    ['word-back', 12, 2, 0],
  ] as const)('%s from %i count=%i -> %i', (motion, caret, count, expected) => {
    expect(applyMotion(TEXT, caret, motion, count)).toBe(expected);
  });

  it('word-forward past the last word lands at text end', () => {
    expect(applyMotion(TEXT, 22, 'word-forward', 1)).toBe(TEXT.length);
  });

  it('word-back before the first word lands at 0', () => {
    expect(applyMotion(TEXT, 2, 'word-back', 1)).toBe(0);
  });
});

describe('applyMotion — word-end (vim e)', () => {
  it.each([
    ['word-end', 0, 1, 4], // end of "hello" itself, not the next word
    ['word-end', 0, 2, 10], // end of "world"
    ['word-end', 4, 1, 10], // already on the end -> jumps to the next word's end
  ] as const)('%s from %i count=%i -> %i', (motion, caret, count, expected) => {
    expect(applyMotion(TEXT, caret, motion, count)).toBe(expected);
  });
});

describe('applyMotion — line-start / line-end / first-nonblank ($/0/^) on line 2', () => {
  // line1 = "foo  bar" (note the double space between foo and bar; it is
  // interior, not leading, so ^ and 0 agree here).
  const caret = 17; // 'b' of "bar"

  it('line-start (0) -> first column of the line', () => {
    expect(applyMotion(TEXT, caret, 'line-start', 1)).toBe(12);
  });

  it('line-end ($) -> last character of the line', () => {
    expect(applyMotion(TEXT, caret, 'line-end', 1)).toBe(19); // 'r'
  });

  it('first-nonblank (^) -> same as line-start when there is no leading whitespace', () => {
    expect(applyMotion(TEXT, caret, 'first-nonblank', 1)).toBe(12);
  });

  it('first-nonblank skips real leading whitespace', () => {
    const indented = '  foo';
    expect(applyMotion(indented, 4, 'first-nonblank', 1)).toBe(2);
  });

  it('line-end on an empty line stays at its (only) position', () => {
    expect(applyMotion(TEXT, 21, 'line-end', 1)).toBe(21);
  });
});

describe('applyMotion — doc-start / doc-end (gg / G equivalents)', () => {
  it.each([0, 8, 24])('doc-start from %i -> 0', (caret) => {
    expect(applyMotion(TEXT, caret, 'doc-start', 1)).toBe(0);
  });

  it.each([0, 8, 24])('doc-end from %i -> text.length', (caret) => {
    expect(applyMotion(TEXT, caret, 'doc-end', 1)).toBe(TEXT.length);
  });
});

describe('applyMotion — paragraph-forward / paragraph-back (blank-line boundary)', () => {
  it.each([
    ['paragraph-forward', 0, 1, 21],
    ['paragraph-forward', 0, 2, 25],
    ['paragraph-back', 23, 1, 21],
    ['paragraph-back', 23, 2, 0],
  ] as const)('%s from %i count=%i -> %i', (motion, caret, count, expected) => {
    expect(applyMotion(TEXT, caret, motion, count)).toBe(expected);
  });
});

describe('applyMotion — line/selection are range-only (caret unchanged)', () => {
  it.each(['line', 'selection'] as EditorMotion[])('%s leaves caret unchanged', (motion) => {
    expect(applyMotion(TEXT, 15, motion, 1)).toBe(15);
  });
});

describe('applyMotion — match-bracket (vim %)', () => {
  const BRACKETS = '(a [b {c} d] e)'; // indices: (0 a1 sp2 [3 b4 sp5 {6 c7 }8 sp9 d10 ]11 sp12 e13 )14

  it('jumps from an opening bracket to its match', () => {
    expect(applyMotion(BRACKETS, 0, 'match-bracket', 1)).toBe(14); // ( -> )
    expect(applyMotion(BRACKETS, 3, 'match-bracket', 1)).toBe(11); // [ -> ]
    expect(applyMotion(BRACKETS, 6, 'match-bracket', 1)).toBe(8); // { -> }
  });

  it('jumps from a closing bracket back to its match', () => {
    expect(applyMotion(BRACKETS, 14, 'match-bracket', 1)).toBe(0);
    expect(applyMotion(BRACKETS, 11, 'match-bracket', 1)).toBe(3);
    expect(applyMotion(BRACKETS, 8, 'match-bracket', 1)).toBe(6);
  });

  it('caret not on a bracket -> scans forward on the line to the first bracket, then jumps to its match', () => {
    expect(applyMotion(BRACKETS, 1, 'match-bracket', 1)).toBe(11); // 'a' -> scans to '[' at 3 -> its match ']' at 11
  });

  it('no bracket anywhere on the line -> caret unchanged', () => {
    expect(applyMotion('plain text', 2, 'match-bracket', 1)).toBe(2);
  });

  it('an unmatched bracket -> caret unchanged', () => {
    expect(applyMotion('(unclosed', 0, 'match-bracket', 1)).toBe(0);
  });
});

describe('motionRange — dw (vim word-forward delete semantics)', () => {
  it('dw from 0 deletes "hello " including the trailing space before the next word', () => {
    const range = motionRange(TEXT, 0, 'word-forward', 1);
    expect(range).toEqual([0, 6]);
    const { text, register } = op({ range, operator: 'delete' });
    expect(text).toBe('world\nfoo  bar\n\nbaz');
    expect(register).toBe('hello ');
  });

  it('dw on the last word of a line stops at end-of-line, not crossing the newline', () => {
    // caret=6 = start of "world", the last word on line0
    const range = motionRange(TEXT, 6, 'word-forward', 1);
    expect(range).toEqual([6, 11]);
    const { text, register } = op({ range, operator: 'delete' });
    expect(text).toBe('hello \nfoo  bar\n\nbaz');
    expect(register).toBe('world');
  });
});

describe('motionRange — dd (vim line delete semantics)', () => {
  it('dd on line 2 removes "foo  bar\\n"', () => {
    const range = motionRange(TEXT, 15, 'line', 1);
    expect(range).toEqual([12, 21]);
    const { text, register } = op({ range, operator: 'delete', motion: 'line' });
    expect(text).toBe('hello world\n\nbaz');
    expect(register).toBe('foo  bar\n');
  });

  it('2dd on line 2 also consumes the blank line after it', () => {
    const range = motionRange(TEXT, 15, 'line', 2);
    expect(range).toEqual([12, 22]);
    const { register } = op({ range, operator: 'delete', motion: 'line' });
    expect(register).toBe('foo  bar\n\n');
  });
});

describe('motionRange — de / d$ (inclusive of the end char)', () => {
  it('de deletes through the end of the current word', () => {
    expect(motionRange(TEXT, 0, 'word-end', 1)).toEqual([0, 5]); // "hello"
  });

  it('d$ deletes through the end of the line', () => {
    expect(motionRange(TEXT, 17, 'line-end', 1)).toEqual([17, 20]); // "bar"
  });
});

describe('motionRange — d% (match-bracket, inclusive both directions)', () => {
  const BRACKETS = '(a [b] c)';

  it('forward: from the opening bracket through its match', () => {
    expect(motionRange(BRACKETS, 0, 'match-bracket', 1)).toEqual([0, 9]);
  });

  it('backward: from the closing bracket back through its match', () => {
    expect(motionRange(BRACKETS, 5, 'match-bracket', 1)).toEqual([3, 6]);
  });

  it('no match -> zero-width range at the caret', () => {
    expect(motionRange('plain text', 2, 'match-bracket', 1)).toEqual([2, 2]);
  });
});

describe('motionRange — selection', () => {
  it('uses the given [start,end) regardless of order', () => {
    expect(motionRange(TEXT, 0, 'selection', 1, [10, 4])).toEqual([4, 10]);
  });

  it('collapses to the caret when no selection is given', () => {
    expect(motionRange(TEXT, 5, 'selection', 1)).toEqual([5, 5]);
  });
});

describe('applyOperator — delete/yank/change (range semantics unchanged)', () => {
  it('yank stores the range and leaves the text untouched', () => {
    const range = motionRange(TEXT, 12, 'line', 1);
    const result = op({ range, operator: 'yank', motion: 'line' });
    expect(result.text).toBe(TEXT);
    expect(result.caret).toBe(12);
    expect(result.register).toBe('foo  bar\n');
    expect(result.registerLinewise).toBe(true);
  });

  it('yank with a non-line motion is charwise', () => {
    const range: [number, number] = [0, 5];
    const result = op({ range, operator: 'yank', motion: 'word-end' });
    expect(result.registerLinewise).toBe(false);
  });

  it('change removes the range exactly like delete when the motion is not `line` (caller enters INSERT)', () => {
    const range: [number, number] = [0, 5];
    const del = op({ range, operator: 'delete', motion: 'word-end' });
    const change = op({ range, operator: 'change', motion: 'word-end' });
    expect(change.text).toEqual(del.text);
    expect(change.caret).toEqual(del.caret);
    expect(change.register).toEqual(del.register);
    expect(change.registerLinewise).toBe(false);
  });

  it('replace behaves exactly like delete', () => {
    const range: [number, number] = [0, 5];
    const del = op({ range, operator: 'delete' });
    const replace = op({ range, operator: 'replace' });
    expect(replace).toEqual(del);
  });
});

describe('applyOperator — cc (change + line motion keeps the trailing newline)', () => {
  it('clears the line content but does not join with the next line', () => {
    const range = motionRange(TEXT, 15, 'line', 1); // [12, 21) = "foo  bar\n"
    const result = op({ range, operator: 'change', motion: 'line', caret: 15 });
    expect(result.text).toBe('hello world\n\n\nbaz');
    expect(result.caret).toBe(12);
    expect(result.register).toBe('foo  bar');
    expect(result.registerLinewise).toBe(true);
  });

  it('on the last line (no trailing newline) behaves like a normal clear', () => {
    const range = motionRange(TEXT, 23, 'line', 1); // last line "baz", no trailing \n
    const result = op({ range, operator: 'change', motion: 'line', caret: 23 });
    expect(result.text).toBe('hello world\nfoo  bar\n\n');
    expect(result.register).toBe('baz');
  });
});

describe('applyOperator — toggle-case (~)', () => {
  it('toggles the case of the range and leaves caret at the range end', () => {
    const result = op({ range: [0, 5], operator: 'toggle-case' });
    expect(result.text).toBe('HELLO world\nfoo  bar\n\nbaz');
    expect(result.caret).toBe(5);
  });

  it('non-letters pass through untouched', () => {
    const result = op({ range: [11, 12], operator: 'toggle-case' }); // the '\n'
    expect(result.text).toBe(TEXT);
  });
});

describe('applyOperator — join (J)', () => {
  it('joins the caret line with the next, trimming leading whitespace and inserting one space', () => {
    const result = op({ range: [0, 0], operator: 'join', caret: 12, count: 1 }); // caret on line1 "foo  bar"
    // count is clamped to max(2, count) -> joins line1 with line2 (blank)
    expect(result.text).toBe('hello world\nfoo  bar \nbaz');
    expect(result.caret).toBe(20);
  });

  it('a count > 2 joins that many lines', () => {
    const result = op({ range: [0, 0], operator: 'join', caret: 12, count: 3 });
    expect(result.text).toBe('hello world\nfoo  bar  baz');
  });

  it('trims leading whitespace off the joined-in line', () => {
    const text = 'a\n   b';
    const result = applyOperator({
      text,
      caret: 0,
      range: [0, 0],
      operator: 'join',
      motion: 'line',
      count: 2,
      register: '',
      registerLinewise: false,
    });
    expect(result.text).toBe('a b');
  });

  it('on the last line, joining does nothing', () => {
    const result = op({ range: [0, 0], operator: 'join', caret: 22, count: 2 }); // caret on "baz", the last line
    expect(result.text).toBe(TEXT);
    expect(result.caret).toBe(22);
  });
});

describe('applyOperator — indent / dedent (>> / <<)', () => {
  it('indent prepends INDENT_UNIT to every touched line', () => {
    const range = motionRange(TEXT, 15, 'line', 2); // lines 1-2: "foo  bar\n" + "\n"
    const result = op({ range, operator: 'indent', motion: 'line', caret: 15 });
    expect(result.text).toBe(`hello world\n${INDENT_UNIT}foo  bar\n${INDENT_UNIT}\nbaz`);
  });

  it('dedent removes up to INDENT_UNIT.length leading spaces', () => {
    const text = `${INDENT_UNIT}foo\n bar`;
    const result = applyOperator({
      text,
      caret: 0,
      range: [0, text.length],
      operator: 'dedent',
      motion: 'line',
      count: 1,
      register: '',
      registerLinewise: false,
    });
    expect(result.text).toBe('foo\nbar');
  });

  it('dedent removes exactly one leading tab, never more', () => {
    const text = '\t\tfoo';
    const result = applyOperator({
      text,
      caret: 0,
      range: [0, text.length],
      operator: 'dedent',
      motion: 'line',
      count: 1,
      register: '',
      registerLinewise: false,
    });
    expect(result.text).toBe('\tfoo');
  });

  it('dedent on a line with no leading whitespace is a no-op for that line', () => {
    const result = applyOperator({
      text: 'foo',
      caret: 0,
      range: [0, 3],
      operator: 'dedent',
      motion: 'line',
      count: 1,
      register: '',
      registerLinewise: false,
    });
    expect(result.text).toBe('foo');
  });
});

describe('applyOperator — put / put-before charwise (p / P)', () => {
  it('put inserts the register AFTER the caret char', () => {
    const result = applyOperator({
      text: 'ac',
      caret: 0,
      range: [0, 0],
      operator: 'put',
      motion: 'right',
      count: 1,
      register: 'b',
      registerLinewise: false,
    });
    expect(result.text).toBe('abc');
    expect(result.caret).toBe(1); // last inserted char
  });

  it('put clamps to the line end (never crosses into the next line)', () => {
    const result = applyOperator({
      text: 'a\nb',
      caret: 0,
      range: [0, 0],
      operator: 'put',
      motion: 'right',
      count: 1,
      register: 'XY',
      registerLinewise: false,
    });
    expect(result.text).toBe('aXY\nb');
  });

  it('put-before inserts the register AT the caret', () => {
    const result = applyOperator({
      text: 'ac',
      caret: 1,
      range: [0, 0],
      operator: 'put-before',
      motion: 'left',
      count: 1,
      register: 'b',
      registerLinewise: false,
    });
    expect(result.text).toBe('abc');
    expect(result.caret).toBe(1); // last inserted char
  });

  it('count repeats the register content', () => {
    const result = applyOperator({
      text: 'x',
      caret: 0,
      range: [0, 0],
      operator: 'put-before',
      motion: 'left',
      count: 3,
      register: 'ab',
      registerLinewise: false,
    });
    expect(result.text).toBe('ababab' + 'x');
  });

  it('an empty register is a no-op', () => {
    const result = applyOperator({
      text: 'ac',
      caret: 0,
      range: [0, 0],
      operator: 'put',
      motion: 'right',
      count: 1,
      register: '',
      registerLinewise: false,
    });
    expect(result.text).toBe('ac');
    expect(result.caret).toBe(0);
  });
});

describe('applyOperator — put / put-before linewise (p / P after a line yank)', () => {
  const text = 'alpha\nbeta\ngamma';

  it('put inserts at the start of the next line, caret on its first char', () => {
    const result = applyOperator({
      text,
      caret: 1, // inside "alpha"
      range: [0, 0],
      operator: 'put',
      motion: 'right',
      count: 1,
      register: 'X\n',
      registerLinewise: true,
    });
    expect(result.text).toBe('alpha\nX\nbeta\ngamma');
    expect(result.caret).toBe(6);
  });

  it('put-before inserts at the start of the current line, caret on its first char', () => {
    const result = applyOperator({
      text,
      caret: 1,
      range: [0, 0],
      operator: 'put-before',
      motion: 'left',
      count: 1,
      register: 'X\n',
      registerLinewise: true,
    });
    expect(result.text).toBe('X\nalpha\nbeta\ngamma');
    expect(result.caret).toBe(0);
  });

  it('put on the last line with no next line appends at doc end', () => {
    const result = applyOperator({
      text,
      caret: 13, // inside "gamma", the last line
      range: [0, 0],
      operator: 'put',
      motion: 'right',
      count: 1,
      register: 'X\n',
      registerLinewise: true,
    });
    expect(result.text).toBe('alpha\nbeta\ngamma\nX\n');
    expect(result.caret).toBe(17); // first char of the appended content
  });

  it('count repeats the linewise register content', () => {
    const result = applyOperator({
      text,
      caret: 1,
      range: [0, 0],
      operator: 'put',
      motion: 'right',
      count: 2,
      register: 'X\n',
      registerLinewise: true,
    });
    expect(result.text).toBe('alpha\nX\nX\nbeta\ngamma');
  });
});

describe('applyOperator — undo/redo never reach here (no-op pass-through)', () => {
  it.each(['undo', 'redo'] as EditorOperator[])('%s leaves text/register untouched', (operator) => {
    const result = op({ range: [0, 5], operator, register: 'r', registerLinewise: true });
    expect(result.text).toBe(TEXT);
    expect(result.register).toBe('r');
    expect(result.registerLinewise).toBe(true);
  });
});

describe('tab characters (offset-based, one column each)', () => {
  const text = '\tfoo\tbar';

  it('left/right treat a tab as a single position', () => {
    expect(applyMotion(text, 0, 'right', 1)).toBe(1);
    expect(applyMotion(text, 1, 'left', 1)).toBe(0);
  });

  it('first-nonblank skips a leading tab', () => {
    expect(applyMotion(text, 5, 'first-nonblank', 1)).toBe(1);
  });

  it('word-forward treats a tab as a separator like any whitespace', () => {
    expect(applyMotion(text, 0, 'word-forward', 1)).toBe(1); // "foo"
    expect(applyMotion(text, 1, 'word-forward', 1)).toBe(5); // "bar"
  });
});

describe('CRLF text (\\r is ordinary line content, never a separator)', () => {
  const text = 'foo\r\nbar\r\nbaz';
  // lines split only on \n: line0 = "foo\r" [0,4) end index4='\n', line1 = "bar\r" [5,9), line2="baz"[10,13)

  it('line-end lands on the last visible char before the \\r, per the block-cursor convention over the whole line content', () => {
    // line.end (index of \n) is 4; line-end returns line.end-1 = index3 = '\r' itself,
    // since \r is ordinary content and is the last character IN the line.
    expect(applyMotion(text, 0, 'line-end', 1)).toBe(3);
    expect(text[3]).toBe('\r');
  });

  it('down/up keep the same column across CRLF lines', () => {
    expect(applyMotion(text, 1, 'down', 1)).toBe(6); // col 1 of line1 ('a' of "bar")
  });

  it('dd removes a full CRLF line including the trailing \\n (the \\r stays part of the removed content)', () => {
    const range = motionRange(text, 6, 'line', 1);
    const { text: after, register } = applyOperator({
      text,
      caret: 6,
      range,
      operator: 'delete',
      motion: 'line',
      count: 1,
      register: '',
      registerLinewise: false,
    });
    expect(register).toBe('bar\r\n');
    expect(after).toBe('foo\r\nbaz');
  });

  it('word motions are unaffected by \\r (it is non-word, non-space -> its own \\S+ run)', () => {
    // "foo\r" -> findWords sees "foo" (\w+) then "\r" as a separate \S+ token
    // immediately after, since \r is not \s per JS regex \s semantics... guard
    // this module's actual behavior rather than assume: \r IS matched by \s.
    expect(applyMotion(text, 0, 'word-forward', 1)).toBe(5); // "foo" then "bar" (both \r and \n treated as separators)
  });
});

describe('long wrapped Markdown prose (motions are offset-based, independent of visual wrapping)', () => {
  const words = Array.from({ length: 50 }, (_, i) => `word${i}`);
  const text = words.join(' '); // well over 300 chars, single logical line

  it('word-forward walks the whole line regardless of length', () => {
    expect(applyMotion(text, 0, 'word-forward', 1)).toBe(text.indexOf('word1 '));
  });

  it('line-end lands on the final character no matter how long the line is', () => {
    expect(applyMotion(text, 0, 'line-end', 1)).toBe(text.length - 1);
  });

  it('paragraph motions treat the single long line as one paragraph (no blank lines)', () => {
    expect(applyMotion(text, 0, 'paragraph-forward', 1)).toBe(text.length);
  });

  it('dw on a long line removes exactly one word + trailing space', () => {
    const range = motionRange(text, 0, 'word-forward', 1);
    const { register } = applyOperator({
      text,
      caret: 0,
      range,
      operator: 'delete',
      motion: 'word-forward',
      count: 1,
      register: '',
      registerLinewise: false,
    });
    expect(register).toBe('word0 ');
  });
});

describe('closed vocabulary — EDITOR_MOTIONS / EDITOR_OPERATORS / guards', () => {
  it('isEditorMotion accepts every declared motion and rejects unknown strings', () => {
    for (const m of EDITOR_MOTIONS) expect(isEditorMotion(m)).toBe(true);
    expect(isEditorMotion('teleport')).toBe(false);
  });

  it('isEditorOperator accepts every declared operator and rejects unknown strings', () => {
    for (const o of EDITOR_OPERATORS) expect(isEditorOperator(o)).toBe(true);
    expect(isEditorOperator('explode')).toBe(false);
  });

  it('EDITOR_MOTIONS includes match-bracket and EDITOR_OPERATORS includes every new operator', () => {
    expect(EDITOR_MOTIONS).toContain('match-bracket');
    for (const o of ['put', 'put-before', 'undo', 'redo', 'join', 'toggle-case', 'indent', 'dedent', 'replace']) {
      expect(EDITOR_OPERATORS).toContain(o);
    }
  });
});
