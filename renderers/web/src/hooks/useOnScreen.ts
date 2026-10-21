import { useEffect, useState, type RefObject } from 'react';

/**
 * Whether `ref`'s element is near the viewport (within `margin`) and the tab is visible.
 * A continuous animation loop pauses on `false` so off-screen work stops.
 */
export function useOnScreen(ref: RefObject<Element | null>, margin = '200px'): boolean {
  const [intersecting, setIntersecting] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setIntersecting(entry.isIntersecting), { rootMargin: margin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, margin]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const update = () => setPageVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  return intersecting && pageVisible;
}
