/**
 * Minimal structural rect shape — geometry math needs only these six
 * numbers; callers may supply a raw `DOMRect`, or a unioned box built from
 * `absUnion` (OrbPreviewNode.tsx) for `display:contents` wrappers whose own
 * `getBoundingClientRect()` is always 0x0.
 */
export interface DOMRectLike {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export type InsertionAxis = 'vertical' | 'horizontal';

/**
 * Pure geometry: given each child's already-resolved rect and the pointer
 * position, returns the index at which a dropped item should be inserted
 * among those children. No DOM access — every rect and the axis are
 * supplied by the caller.
 */
export function computeInsertionIndex(
  childRects: readonly DOMRectLike[],
  pointer: { x: number; y: number },
  axis: InsertionAxis,
): number {
  if (axis === 'vertical') {
    const at = childRects.findIndex((rect) => pointer.y < rect.top + rect.height / 2);
    return at === -1 ? childRects.length : at;
  }
  // A horizontal container may wrap: find the cursor's line, then order by x within it.
  for (const line of wrappedLines(childRects)) {
    if (pointer.y > line.bottom) continue;
    const at = line.indices.find((i) => pointer.x < childRects[i].left + childRects[i].width / 2);
    return at ?? line.indices[line.indices.length - 1] + 1;
  }
  return childRects.length;
}

interface WrappedLine {
  indices: number[];
  bottom: number;
}

/** Flex-wrap lines in DOM order: a child whose vertical range overlaps the current line joins it. */
function wrappedLines(childRects: readonly DOMRectLike[]): WrappedLine[] {
  const lines: Array<WrappedLine & { top: number }> = [];
  childRects.forEach((rect, i) => {
    const line = lines[lines.length - 1];
    if (line && rect.top < line.bottom && rect.bottom > line.top) {
      line.indices.push(i);
      line.top = Math.min(line.top, rect.top);
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else {
      lines.push({ indices: [i], top: rect.top, bottom: rect.bottom });
    }
  });
  return lines;
}
