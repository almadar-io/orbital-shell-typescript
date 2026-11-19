'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

const CLIPS = new Set(['auto', 'scroll', 'hidden', 'clip']);

/** The slice of an element the viewer can see, in the element's own coordinates. */
export interface VisibleBand {
  top: number;
  height: number;
}

/**
 * The part of `ref` that is on screen: the window and every clipping ancestor
 * cut it down. A contained overlay taller than its scroller (a preview frame
 * grown to its content) places its dialog in this band so it opens where the
 * viewer is looking. `null` while disabled or unmeasured.
 */
export function useVisibleBand(ref: RefObject<HTMLElement | null>, enabled: boolean): VisibleBand | null {
  const [band, setBand] = useState<VisibleBand | null>(null);
  useLayoutEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setBand(null);
      return;
    }
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      let clipTop = 0;
      let clipBottom = window.innerHeight;
      for (let a = el.parentElement; a; a = a.parentElement) {
        if (!CLIPS.has(window.getComputedStyle(a).overflowY)) continue;
        const r = a.getBoundingClientRect();
        clipTop = Math.max(clipTop, r.top);
        clipBottom = Math.min(clipBottom, r.bottom);
      }
      const top = Math.max(0, clipTop - rect.top);
      const bottom = Math.min(rect.height, clipBottom - rect.top);
      const next = { top, height: Math.max(0, bottom - top) };
      setBand((prev) => (prev && prev.top === next.top && prev.height === next.height ? prev : next));
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [ref, enabled]);
  return band;
}
