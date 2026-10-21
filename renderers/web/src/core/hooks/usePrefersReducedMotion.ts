'use client';

import { useMediaQuery } from './useMediaQuery';

/** Whether the OS asks for reduced motion — the one gate for JS/rAF/camera animations (CSS ones collapse in `_base.css`). */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
