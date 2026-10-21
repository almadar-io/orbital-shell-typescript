/**
 * The edit arithmetic behind assisted editing: suggestions are ranges on the
 * code they were made for; they stay true while the author types elsewhere,
 * shrink while the author types what they suggest, and apply one or all at once.
 */
import { describe, expect, it } from 'vitest';
import { applySuggestions, orderSuggestions, remapSuggestions, singleChange, type CodeSuggestion } from '../codeAssist';

describe('singleChange', () => {
  it('finds the one edited span between two versions', () => {
    expect(singleChange('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, text: 'XY' });
    expect(singleChange('ab', 'abc')).toEqual({ from: 2, to: 2, text: 'c' });
  });

  it('control: no change is null', () => {
    expect(singleChange('same', 'same')).toBeNull();
  });

  it('edge: a repeated character is attributed to the end, never double-counted', () => {
    expect(singleChange('aa', 'aaa')).toEqual({ from: 2, to: 2, text: 'a' });
    expect(singleChange('abc', '')).toEqual({ from: 0, to: 3, text: '' });
  });
});

describe('remapSuggestions', () => {
  const fixes: CodeSuggestion[] = [
    { from: 2, to: 4, text: 'X' },
    { from: 10, to: 12, text: 'Y' },
  ];

  it('a change before a suggestion shifts it; after it, leaves it', () => {
    expect(remapSuggestions(fixes, { from: 6, to: 6, text: 'zz' })).toEqual([
      { from: 2, to: 4, text: 'X' },
      { from: 12, to: 14, text: 'Y' },
    ]);
  });

  it('control: a change overlapping a suggestion drops it', () => {
    expect(remapSuggestions(fixes, { from: 3, to: 5, text: '' })).toEqual([{ from: 8, to: 10, text: 'Y' }]);
  });

  it('edge: typing what an insertion suggests shrinks it; typing something else drops it', () => {
    const ghost: CodeSuggestion[] = [{ from: 5, to: 5, text: 'name ?name)' }];
    expect(remapSuggestions(ghost, { from: 5, to: 5, text: 'na' })).toEqual([{ from: 7, to: 7, text: 'me ?name)' }]);
    expect(remapSuggestions(ghost, { from: 5, to: 5, text: 'x' })).toEqual([]);
    expect(remapSuggestions(ghost, { from: 5, to: 5, text: 'name ?name)' })).toEqual([]);
  });
});

describe('applySuggestions', () => {
  it('applies all of them against the code they were made for', () => {
    expect(applySuggestions('0123456789', [{ from: 1, to: 2, text: 'A' }, { from: 5, to: 5, text: 'BB' }], 5)).toEqual({ code: '0A234BB56789', caret: 7 });
  });

  it('control: no suggestions leave the code and caret', () => {
    expect(applySuggestions('abc', [], 1)).toEqual({ code: 'abc', caret: 1 });
  });

  it('edge: the caret follows edits before it, and lands after an insertion at it', () => {
    expect(applySuggestions('abc', [{ from: 0, to: 1, text: 'XYZ' }], 2)).toEqual({ code: 'XYZbc', caret: 4 });
    expect(applySuggestions('abc', [{ from: 3, to: 3, text: 'd' }], 1)).toEqual({ code: 'abcd', caret: 1 });
  });
});

describe('orderSuggestions', () => {
  it('the one at the caret comes first, then by position', () => {
    const s: CodeSuggestion[] = [{ from: 9, to: 9, text: 'c' }, { from: 1, to: 2, text: 'a' }, { from: 5, to: 5, text: 'b' }];
    expect(orderSuggestions(s, 5).map((x) => x.text)).toEqual(['b', 'a', 'c']);
  });

  it('control: with none at the caret, by position', () => {
    expect(orderSuggestions([{ from: 4, to: 4, text: 'b' }, { from: 0, to: 0, text: 'a' }], 2).map((x) => x.text)).toEqual(['a', 'b']);
  });
});
