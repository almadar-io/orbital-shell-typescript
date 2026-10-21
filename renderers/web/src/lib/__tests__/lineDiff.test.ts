import { describe, it, expect } from 'vitest';
import { computeLineDiff } from '../lineDiff';

describe('computeLineDiff', () => {
  it('an inserted line is one addition; the lines after it stay unchanged', () => {
    const diff = computeLineDiff('a\nb\nc', 'a\nX\nb\nc');
    expect(diff.map((l) => `${l.type}:${l.content}`)).toEqual(['unchanged:a', 'added:X', 'unchanged:b', 'unchanged:c']);
    expect(diff[2]).toMatchObject({ beforeLineNumber: 2, afterLineNumber: 3 });
  });

  it('a changed line is one removal then one addition', () => {
    const diff = computeLineDiff('title\nblue', 'title\ngreen');
    expect(diff.map((l) => l.type)).toEqual(['unchanged', 'removed', 'added']);
  });

  it('control: identical texts are all unchanged', () => {
    expect(computeLineDiff('a\nb', 'a\nb').every((l) => l.type === 'unchanged')).toBe(true);
  });

  it('edge: empty before is all additions; empty after is all removals', () => {
    expect(computeLineDiff('', 'x').map((l) => l.type)).toEqual(['added']);
    expect(computeLineDiff('x\ny', '').map((l) => l.type)).toEqual(['removed', 'removed']);
  });
});

/** Longest common subsequence length by the full table — the reference a diff's kept lines must reach. */
function lcsLength(a: string[], b: string[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  return dp[0][0];
}

/** Deterministic pseudo-random lines over a small alphabet, so texts share many lines. */
function randomLines(seed: number, count: number): string[] {
  let s = seed;
  const next = (): number => { s = (s * 1103515245 + 12345) % 2147483648; return s; };
  return Array.from({ length: count }, () => 'abcde'[next() % 5]);
}

describe('computeLineDiff — minimal, and linear in space', () => {
  it('keeps exactly a longest common subsequence, and replays both texts', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const a = randomLines(seed, 1 + (seed % 23));
      const b = randomLines(seed * 7 + 3, 1 + ((seed * 5) % 19));
      const diff = computeLineDiff(a.join('\n'), b.join('\n'));
      expect(diff.filter((l) => l.type === 'unchanged')).toHaveLength(lcsLength(a, b));
      expect(diff.filter((l) => l.type !== 'added').map((l) => l.content)).toEqual(a);
      expect(diff.filter((l) => l.type !== 'removed').map((l) => l.content)).toEqual(b);
    }
  });

  it('line numbers count each side independently', () => {
    const diff = computeLineDiff('a\nb\nc\nd', 'a\nx\nc\nd\ne');
    expect(diff.filter((l) => l.type !== 'added').map((l) => l.beforeLineNumber)).toEqual([1, 2, 3, 4]);
    expect(diff.filter((l) => l.type !== 'removed').map((l) => l.afterLineNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a 10 000-line file with one inserted line diffs fast — no table of every line pair', () => {
    const before = Array.from({ length: 10_000 }, (_, i) => `  "line": ${i},`);
    const after = [...before.slice(0, 5_000), '  "inserted": true,', ...before.slice(5_000)];
    const start = performance.now();
    const diff = computeLineDiff(before.join('\n'), after.join('\n'));
    expect(performance.now() - start).toBeLessThan(300);
    expect(diff.filter((l) => l.type === 'added').map((l) => l.content)).toEqual(['  "inserted": true,']);
    expect(diff.filter((l) => l.type === 'removed')).toHaveLength(0);
  });

  it('edge: two large texts with nothing in common are all removals then additions', () => {
    const before = Array.from({ length: 3_000 }, (_, i) => `old ${i}`);
    const after = Array.from({ length: 3_000 }, (_, i) => `new ${i}`);
    const diff = computeLineDiff(before.join('\n'), after.join('\n'));
    expect(diff.filter((l) => l.type === 'removed')).toHaveLength(3_000);
    expect(diff.filter((l) => l.type === 'added')).toHaveLength(3_000);
  });
});
