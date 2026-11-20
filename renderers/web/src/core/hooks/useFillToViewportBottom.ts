'use client';

import { useCallback, useEffect, useState } from 'react';

const BOTTOM_GAP_PX = 16;
const MIN_HEIGHT_PX = 320;

/**
 * Size an element from where it starts to the bottom of the screen (Trello's board: the lists keep to the screen and
 * scroll their own cards, so the board's sideways scrollbar stays in view). Answers a callback ref and the height in
 * pixels, or undefined when disabled or not yet measured.
 */
export function useFillToViewportBottom(enabled: boolean): [(node: HTMLElement | null) => void, number | undefined] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  const measure = useCallback(() => {
    if (!enabled || node === null || typeof window === 'undefined') return;
    const top = node.getBoundingClientRect().top;
    setHeight(Math.max(MIN_HEIGHT_PX, Math.round(window.innerHeight - top - BOTTOM_GAP_PX)));
  }, [enabled, node]);

  useEffect(() => {
    if (!enabled || node === null) {
      setHeight(undefined);
      return;
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [enabled, node, measure]);

  return [setNode, height];
}
