/** One line of a line-level diff between two texts. */
export interface LineDiffLine {
  type: 'added' | 'removed' | 'unchanged';
  beforeLineNumber?: number;
  afterLineNumber?: number;
  content: string;
}

const linesOf = (text: string): string[] => (text === '' ? [] : text.split('\n'));

/**
 * Minimal line diff — the one diff every diff view renders. Empty text has no lines.
 * Myers' O(ND) algorithm with the linear-space middle-snake split (what git uses):
 * time grows with the size of the change, memory with the size of the texts.
 */
export function computeLineDiff(before: string, after: string): LineDiffLine[] {
  const a = linesOf(before);
  const b = linesOf(after);
  const ops: DiffOp[] = [];
  diffRange(a, 0, a.length, b, 0, b.length, ops);
  const out: LineDiffLine[] = [];
  let bn = 1;
  let an = 1;
  for (const op of ops) {
    if (op.type === 'unchanged') out.push({ type: 'unchanged', beforeLineNumber: bn++, afterLineNumber: an++, content: a[op.index] });
    else if (op.type === 'removed') out.push({ type: 'removed', beforeLineNumber: bn++, content: a[op.index] });
    else out.push({ type: 'added', afterLineNumber: an++, content: b[op.index] });
  }
  return out;
}

/** One edit, pointing at its line in `before` (unchanged, removed) or `after` (added). */
interface DiffOp {
  type: LineDiffLine['type'];
  index: number;
}

function diffRange(a: string[], aLo: number, aHi: number, b: string[], bLo: number, bHi: number, ops: DiffOp[]): void {
  let prefix = 0;
  while (aLo + prefix < aHi && bLo + prefix < bHi && a[aLo + prefix] === b[bLo + prefix]) prefix++;
  for (let i = 0; i < prefix; i++) ops.push({ type: 'unchanged', index: aLo + i });
  aLo += prefix;
  bLo += prefix;
  let suffix = 0;
  while (aHi - suffix > aLo && bHi - suffix > bLo && a[aHi - suffix - 1] === b[bHi - suffix - 1]) suffix++;
  const tail = aHi - suffix;
  aHi -= suffix;
  bHi -= suffix;

  if (aLo === aHi) for (let j = bLo; j < bHi; j++) ops.push({ type: 'added', index: j });
  else if (bLo === bHi) for (let i = aLo; i < aHi; i++) ops.push({ type: 'removed', index: i });
  else {
    const [x, y, u, v] = middleSnake(a, aLo, aHi, b, bLo, bHi);
    diffRange(a, aLo, x, b, bLo, y, ops);
    for (let i = x; i < u; i++) ops.push({ type: 'unchanged', index: i });
    diffRange(a, u, aHi, b, v, bHi, ops);
  }
  for (let i = 0; i < suffix; i++) ops.push({ type: 'unchanged', index: tail + i });
}

/**
 * The snake in the middle of a shortest edit path between a[aLo..aHi) and
 * b[bLo..bHi) (both non-empty, differing at both ends): [x, y, u, v] in
 * absolute indices, the diagonal run from (x, y) to (u, v).
 */
function middleSnake(a: string[], aLo: number, aHi: number, b: string[], bLo: number, bHi: number): [number, number, number, number] {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const delta = n - m;
  const odd = (delta & 1) !== 0;
  const max = Math.ceil((n + m) / 2);
  const offset = max + 1;
  const forward = new Int32Array(2 * max + 3);
  const backward = new Int32Array(2 * max + 3);
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && forward[offset + k - 1] < forward[offset + k + 1]) ? forward[offset + k + 1] : forward[offset + k - 1] + 1;
      let y = x - k;
      const x0 = x;
      const y0 = y;
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x++;
        y++;
      }
      forward[offset + k] = x;
      const kb = delta - k;
      if (odd && kb >= -(d - 1) && kb <= d - 1 && x + backward[offset + kb] >= n) {
        return [aLo + x0, bLo + y0, aLo + x, bLo + y];
      }
    }
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && backward[offset + k - 1] < backward[offset + k + 1]) ? backward[offset + k + 1] : backward[offset + k - 1] + 1;
      let y = x - k;
      const x0 = x;
      const y0 = y;
      while (x < n && y < m && a[aHi - 1 - x] === b[bHi - 1 - y]) {
        x++;
        y++;
      }
      backward[offset + k] = x;
      const kf = delta - k;
      if (!odd && kf >= -d && kf <= d && x + forward[offset + kf] >= n) {
        return [aHi - x, bHi - y, aHi - x0, bHi - y0];
      }
    }
  }
  throw new Error('computeLineDiff: no middle snake — unreachable for differing texts');
}
