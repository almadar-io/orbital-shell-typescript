'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Reactively track a CSS media query (e.g. `'(pointer: coarse)'`).
 *
 * Components whose LAYOUT MATH depends on a media feature (a JS-computed
 * grid track, an inline-action budget) can't express it in CSS alone —
 * this hook is the one owner for that. `false` on the server and wherever
 * there is no `matchMedia`.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => hasMatchMedia() && window.matchMedia(query).matches,
    () => false,
  );
}

/** Some environments (jsdom, some embedded webviews) have no media-query support: nothing matches there. */
function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}
