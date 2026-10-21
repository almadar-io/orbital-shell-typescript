import { useEffect, useMemo } from 'react';
import type { EventKey } from '@almadar/core';
import { useEventBus } from '../core';
import { resolveKeyMapEvent } from '../lib/keyMapEvent';

/**
 * Keyboard → semantic events: a keydown/keyup whose `e.code` (optionally `Mod+`/`Shift+`/`Alt+`
 * prefixed) is in the map emits `UI:{event}` on the bus — the same contract as the game canvases'
 * `keyMap`. Window-scoped, so no focus gate; keystrokes inside inputs never route.
 */
export function useKeyMapEvents(keyMap: Record<string, EventKey> | undefined, keyUpMap: Record<string, EventKey> | undefined): void {
  const eventBus = useEventBus();
  // Keyed by content: a parent passing a fresh literal each render must not re-attach the
  // listeners every frame and drop the keys that land in the gap.
  const keyMapKey = keyMap ? JSON.stringify(keyMap) : null;
  const keyUpMapKey = keyUpMap ? JSON.stringify(keyUpMap) : null;
  const stableKeyMap = useMemo(() => keyMap, [keyMapKey]);
  const stableKeyUpMap = useMemo(() => keyUpMap, [keyUpMapKey]);

  useEffect(() => {
    if (!stableKeyMap && !stableKeyUpMap) return;
    const onDown = (e: KeyboardEvent) => {
      const ev = resolveKeyMapEvent(stableKeyMap, e);
      if (ev) {
        eventBus.emit(`UI:${ev}`, {});
        e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const ev = resolveKeyMapEvent(stableKeyUpMap, e);
      if (ev) eventBus.emit(`UI:${ev}`, {});
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [stableKeyMap, stableKeyUpMap, eventBus]);
}
