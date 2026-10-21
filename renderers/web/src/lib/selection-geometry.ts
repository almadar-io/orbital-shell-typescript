/**
 * Where the design-selection overlay draws its spacing handles, from the
 * selected container's box and its direct children's boxes (all in the
 * card's content coordinates).
 */
import { spacingTokenOf, type DesignAlignment, type DesignAxisPosition, type DesignConstraint, type DesignJustify, type SpacingStepPx } from './design-classes';

export interface OverlayRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type LayoutAxis = 'horizontal' | 'vertical';

/** One handle per gap between consecutive children, spanning that gap. */
export function gapHandleRects(children: readonly OverlayRect[], axis: LayoutAxis): OverlayRect[] {
  const out: OverlayRect[] = [];
  for (let i = 0; i + 1 < children.length; i++) {
    const a = children[i];
    const b = children[i + 1];
    if (axis === 'vertical') {
      const top = a.top + a.height;
      const left = Math.min(a.left, b.left);
      out.push({ top, left, width: Math.max(a.left + a.width, b.left + b.width) - left, height: Math.max(0, b.top - top) });
    } else {
      const left = a.left + a.width;
      const top = Math.min(a.top, b.top);
      out.push({ top, left, width: Math.max(0, b.left - left), height: Math.max(a.top + a.height, b.top + b.height) - top });
    }
  }
  return out;
}

export type PaddingSide = 'top' | 'right' | 'bottom' | 'left';

/** The band between the container's edge and its children, per side. */
export function paddingHandleRects(container: OverlayRect, children: readonly OverlayRect[]): Record<PaddingSide, OverlayRect> {
  const inner = children.length === 0
    ? container
    : children.reduce((u, c) => {
        const top = Math.min(u.top, c.top);
        const left = Math.min(u.left, c.left);
        const bottom = Math.max(u.top + u.height, c.top + c.height);
        const right = Math.max(u.left + u.width, c.left + c.width);
        return { top, left, width: right - left, height: bottom - top };
      });
  const cRight = container.left + container.width;
  const cBottom = container.top + container.height;
  const iRight = inner.left + inner.width;
  const iBottom = inner.top + inner.height;
  return {
    top: { top: container.top, left: container.left, width: container.width, height: Math.max(0, inner.top - container.top) },
    bottom: { top: iBottom, left: container.left, width: container.width, height: Math.max(0, cBottom - iBottom) },
    left: { top: container.top, left: container.left, width: Math.max(0, inner.left - container.left), height: container.height },
    right: { top: container.top, left: iRight, width: Math.max(0, cRight - iRight), height: container.height },
  };
}

/** Thickness of the insertion line, in content pixels. */
export const INSERTION_LINE_PX = 2;

/**
 * Where the drop insertion line goes for inserting at `index` among
 * `children` of a container flowing along `axis`: before child `index`, after
 * the last child, or along the container's leading edge when it is empty.
 */
export function insertionLineRect(
  container: OverlayRect,
  children: readonly OverlayRect[],
  index: number,
  axis: LayoutAxis,
): OverlayRect {
  const half = INSERTION_LINE_PX / 2;
  if (children.length === 0) {
    return axis === 'vertical'
      ? { top: container.top, left: container.left, width: container.width, height: INSERTION_LINE_PX }
      : { top: container.top, left: container.left, width: INSERTION_LINE_PX, height: container.height };
  }
  const clamped = Math.max(0, Math.min(index, children.length));
  const before: OverlayRect | undefined = children[clamped];
  const after: OverlayRect | undefined = children[clamped - 1];
  const ref = before ?? after ?? container;
  if (axis === 'vertical') {
    const edge = before && after
      ? (after.top + after.height + before.top) / 2
      : before ? before.top : after ? after.top + after.height : container.top;
    return { top: edge - half, left: ref.left, width: ref.width, height: INSERTION_LINE_PX };
  }
  const edge = before && after
    ? (after.left + after.width + before.left) / 2
    : before ? before.left : after ? after.left + after.width : container.left;
  return { top: ref.top, left: edge - half, width: INSERTION_LINE_PX, height: ref.height };
}

const GRID_POSITION: Readonly<Record<string, DesignAlignment>> = {
  'flex-start': 'start', start: 'start', 'self-start': 'start', left: 'start',
  center: 'center',
  'flex-end': 'end', end: 'end', 'self-end': 'end', right: 'end',
};

/**
 * Where a flex container's computed alignment sits on the 3×3 grid (cross
 * axis `alignItems`, main axis `justifyContent`, where space-between is its
 * own main-axis mode); null for values it can't show (stretch, baseline, the
 * other space-* values). `normal` main-axis packing is start.
 */
export function renderedAlignment(style: Pick<CSSStyleDeclaration, 'alignItems' | 'justifyContent'>): {
  align: DesignAlignment | null;
  justify: DesignJustify | null;
} {
  const justify: DesignJustify | null = style.justifyContent === 'normal'
    ? 'start'
    : style.justifyContent === 'space-between' ? 'between' : GRID_POSITION[style.justifyContent] ?? null;
  return { align: GRID_POSITION[style.alignItems] ?? null, justify };
}

/** An element's distances from its parent's four sides (negative where it sticks out), and the parent's size. */
export interface OffsetInParent {
  left: number;
  top: number;
  right: number;
  bottom: number;
  parentWidth: number;
  parentHeight: number;
}

export function offsetWithin(child: OverlayRect, parent: OverlayRect): OffsetInParent {
  return {
    left: child.left - parent.left,
    top: child.top - parent.top,
    right: parent.left + parent.width - (child.left + child.width),
    bottom: parent.top + parent.height - (child.top + child.height),
    parentWidth: parent.width,
    parentHeight: parent.height,
  };
}

/**
 * What each spacing step renders at on `el`: steps the preset maps to a
 * `--space-N` theme token read that token in `el`'s scope (themes differ, and
 * aren't linear); the rest are Tailwind's 0.25rem steps.
 */
export function spacingScaleOf(el: Element): SpacingStepPx {
  const style = getComputedStyle(el);
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const rem = Number.isFinite(rootPx) && rootPx > 0 ? rootPx : 16;
  const toPx = (value: string): number | null => {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return null;
    return value.trim().endsWith('rem') ? n * rem : n;
  };
  return (step) => {
    const token = spacingTokenOf(step);
    const themed = token ? toPx(style.getPropertyValue(token)) : null;
    return themed ?? (step * rem) / 4;
  };
}

type SpacingStyle = Pick<CSSStyleDeclaration, 'rowGap' | 'columnGap' | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft'>;

const pxOrZero = (value: string): number => {
  const px = parseFloat(value);
  return Number.isFinite(px) ? px : 0;
};

/** A layout container's gap (along its direction) and padding, as rendered, in px. */
export function renderedSpacing(style: SpacingStyle, axis: LayoutAxis): { gap: number; top: number; right: number; bottom: number; left: number } {
  return {
    gap: pxOrZero(axis === 'vertical' ? style.rowGap : style.columnGap),
    top: pxOrZero(style.paddingTop),
    right: pxOrZero(style.paddingRight),
    bottom: pxOrZero(style.paddingBottom),
    left: pxOrZero(style.paddingLeft),
  };
}

/**
 * The element that actually lays out a pattern container: `[data-pattern]`
 * wrappers are `display: contents`, so walk down to the first element that
 * generates a box (the real Stack/Grid div), or the element itself if none.
 */
export function layoutBoxOf(el: Element): Element {
  let cur: Element = el;
  while (getComputedStyle(cur).display === 'contents' && cur.firstElementChild) {
    cur = cur.firstElementChild;
  }
  return cur;
}

/** The box a marquee drag spans, whichever direction it was dragged. */
export function marqueeRect(from: { x: number; y: number }, to: { x: number; y: number }): OverlayRect {
  return {
    top: Math.min(from.y, to.y),
    left: Math.min(from.x, to.x),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** Indices of the boxes a marquee touches (Figma: touching is enough), in order. */
export function marqueeHits(marquee: OverlayRect, boxes: readonly OverlayRect[]): number[] {
  return boxes.flatMap((box, index) =>
    box.left < marquee.left + marquee.width &&
    marquee.left < box.left + box.width &&
    box.top < marquee.top + marquee.height &&
    marquee.top < box.top + box.height
      ? [index]
      : [],
  );
}

/**
 * An element's offsets under a constraint, from where it sits now: px to the
 * pinned side(s), the offset of its centre from the parent's centre, or (scale)
 * its distances as % of the parent. Needs the measured offset — callers wait for it.
 */
export function axisPositionFrom(axis: 'x' | 'y', constraint: DesignConstraint, offset: OffsetInParent): DesignAxisPosition {
  const start = axis === 'x' ? offset.left : offset.top;
  const end = axis === 'x' ? offset.right : offset.bottom;
  if (constraint === 'center') return { constraint, start: (start - end) / 2, end: 0 };
  if (constraint !== 'scale') return { constraint, start, end };
  const size = axis === 'x' ? offset.parentWidth : offset.parentHeight;
  return size > 0 ? { constraint, start: (start / size) * 100, end: (end / size) * 100 } : { constraint, start: 0, end: 0 };
}

/** A smart-guide line: vertical at x = `at` (or horizontal at y = `at`), spanning `from`–`to` on the other axis. */
export interface GuideLine {
  orientation: 'vertical' | 'horizontal';
  at: number;
  from: number;
  to: number;
}

const edgesX = (r: OverlayRect): number[] => [r.left, r.left + r.width / 2, r.left + r.width];
const edgesY = (r: OverlayRect): number[] => [r.top, r.top + r.height / 2, r.top + r.height];

/** The smallest correction (within `threshold`) that lines one of `mine` up with one of `theirs` across all targets. */
function nearestSnap(mine: (r: OverlayRect) => number[], moving: OverlayRect, targets: readonly OverlayRect[], threshold: number): number {
  let best = 0;
  let bestAbs = Infinity;
  for (const t of targets) {
    for (const a of mine(moving)) {
      for (const b of mine(t)) {
        const d = b - a;
        if (Math.abs(d) <= threshold && Math.abs(d) < bestAbs) {
          best = d;
          bestAbs = Math.abs(d);
        }
      }
    }
  }
  return bestAbs === Infinity ? 0 : best;
}

/**
 * Figma smart guides for a box being moved: snap its edges or centre to the
 * nearest edge or centre of a target (siblings, the parent) within
 * `threshold` px, per axis, and the guide lines that now line up.
 */
export function snapMove(moving: OverlayRect, targets: readonly OverlayRect[], threshold: number): { dx: number; dy: number; guides: GuideLine[] } {
  const dx = nearestSnap(edgesX, moving, targets, threshold);
  const dy = nearestSnap(edgesY, moving, targets, threshold);
  const snapped = { ...moving, left: moving.left + dx, top: moving.top + dy };
  const guides: GuideLine[] = [];
  for (const t of targets) {
    for (const x of edgesX(t)) {
      if (edgesX(snapped).includes(x)) {
        guides.push({ orientation: 'vertical', at: x, from: Math.min(snapped.top, t.top), to: Math.max(snapped.top + snapped.height, t.top + t.height) });
      }
    }
    for (const y of edgesY(t)) {
      if (edgesY(snapped).includes(y)) {
        guides.push({ orientation: 'horizontal', at: y, from: Math.min(snapped.left, t.left), to: Math.max(snapped.left + snapped.width, t.left + t.width) });
      }
    }
  }
  return { dx, dy, guides };
}

/** A measurement line between two points, with its length in whole pixels. */
export interface MeasureLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
}

function line(x1: number, y1: number, x2: number, y2: number): MeasureLine {
  return { x1, y1, x2, y2, length: Math.round(Math.hypot(x2 - x1, y2 - y1)) };
}

/**
 * Figma's ⌥-hover distances from the selection to another box: to each side
 * of a box that contains it, else the horizontal and/or vertical gap to a box
 * beside it (drawn where they overlap, else through the selection's centre).
 * Overlapping boxes measure nothing, nor do zero-length gaps.
 */
export function distanceLines(selected: OverlayRect, other: OverlayRect): MeasureLine[] {
  const s = { l: selected.left, t: selected.top, r: selected.left + selected.width, b: selected.top + selected.height };
  const o = { l: other.left, t: other.top, r: other.left + other.width, b: other.top + other.height };
  const cx = (s.l + s.r) / 2;
  const cy = (s.t + s.b) / 2;
  const lines: MeasureLine[] = [];
  if (o.l <= s.l && o.t <= s.t && o.r >= s.r && o.b >= s.b) {
    lines.push(line(cx, s.t, cx, o.t), line(s.r, cy, o.r, cy), line(cx, s.b, cx, o.b), line(s.l, cy, o.l, cy));
    return lines.filter((l) => l.length > 0);
  }
  const overlapY = Math.max(s.t, o.t) < Math.min(s.b, o.b);
  const overlapX = Math.max(s.l, o.l) < Math.min(s.r, o.r);
  const y = overlapY ? (Math.max(s.t, o.t) + Math.min(s.b, o.b)) / 2 : cy;
  const x = overlapX ? (Math.max(s.l, o.l) + Math.min(s.r, o.r)) / 2 : cx;
  if (o.l >= s.r) lines.push(line(s.r, y, o.l, y));
  else if (o.r <= s.l) lines.push(line(s.l, y, o.r, y));
  if (o.t >= s.b) lines.push(line(x, s.b, x, o.t));
  else if (o.b <= s.t) lines.push(line(x, s.t, x, o.b));
  return lines.filter((l) => l.length > 0);
}
