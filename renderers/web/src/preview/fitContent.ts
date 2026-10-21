/**
 * Fitting a preview's rendered component — the slot content, not the padded
 * page around it — into a box: scaled down (never up) to fit, then centered.
 */

export interface FitSize {
  width: number;
  height: number;
}

export interface FitRect extends FitSize {
  x: number;
  y: number;
}

/** A `translate(x, y) scale(scale)` with origin top-left. */
export interface FitTransform {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY: FitTransform = { scale: 1, x: 0, y: 0 };

/** The transform that fits `content` (in unscaled layout coordinates) into `box` and centers it. */
export function fitContentTransform(box: FitSize, content: FitRect): FitTransform {
  if (box.width <= 0 || box.height <= 0 || content.width <= 0 || content.height <= 0) return IDENTITY;
  const scale = Math.min(1, box.width / content.width, box.height / content.height);
  return {
    scale,
    x: box.width / 2 - (content.x + content.width / 2) * scale,
    y: box.height / 2 - (content.y + content.height / 2) * scale,
  };
}

/**
 * The union of everything rendered into the preview's slots (every element
 * inside a `[data-orb-slot]`), in `inner`'s unscaled layout coordinates. `scale` is the scale
 * currently applied to `inner`. Null when nothing has rendered.
 */
export function slotContentRect(inner: HTMLElement, scale: number): FitRect | null {
  const origin = inner.getBoundingClientRect();
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  // Every rendered element, not just the slot's direct children: content can overflow its wrapper.
  for (const slot of Array.from(inner.querySelectorAll<HTMLElement>('[data-orb-slot]'))) {
    for (const child of Array.from(slot.querySelectorAll('*'))) {
      const r = child.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
  }
  if (left === Infinity) return null;
  return {
    x: (left - origin.left) / scale,
    y: (top - origin.top) / scale,
    width: (right - left) / scale,
    height: (bottom - top) / scale,
  };
}
