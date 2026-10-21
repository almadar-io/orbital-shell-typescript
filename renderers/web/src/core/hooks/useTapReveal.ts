import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hover-only reveals (tooltips, hover-popovers, submenus, `Box.hoverEvent`) have no hover on
 * touch, so they're invisible/unreachable. This adds the tap-to-reveal fallback: on a touch/pen
 * tap the surface reveals and fires the SAME event the hover path fires; a tap outside dismisses.
 * Mouse is left to the component's existing hover handlers (`pointerType === 'mouse'` is ignored),
 * so this is purely additive — no behavior change on desktop.
 */

export interface TapRevealOptions {
  /** Fired when a tap reveals — reuse to emit the component's existing hover event. */
  onReveal?: () => void;
  /** Fired when an outside tap (or a second trigger tap) dismisses. */
  onDismiss?: () => void;
  /**
   * Elements considered "inside" for outside-tap detection. Pass the trigger and the surface
   * (the surface may be portaled, so it isn't a DOM descendant of the trigger). A tap whose
   * target is inside none of these dismisses.
   */
  refs?: ReadonlyArray<React.RefObject<HTMLElement | null>>;
  /** When false, taps are ignored (hover-only). Default true. */
  enabled?: boolean;
}

export interface TapRevealResult {
  /** Whether the surface is currently revealed via a tap. OR this with the hover state. */
  revealed: boolean;
  /** Spread on the trigger; toggles reveal on a touch/pen tap (ignores mouse). */
  triggerProps: { onPointerDown: (e: React.PointerEvent) => void };
  reveal: () => void;
  dismiss: () => void;
}

export function useTapReveal(options: TapRevealOptions = {}): TapRevealResult {
  const { onReveal, onDismiss, refs, enabled = true } = options;
  const [revealed, setRevealed] = useState(false);

  const onRevealRef = useRef(onReveal);
  const onDismissRef = useRef(onDismiss);
  onRevealRef.current = onReveal;
  onDismissRef.current = onDismiss;

  const reveal = useCallback(() => {
    setRevealed((wasRevealed) => {
      if (!wasRevealed) onRevealRef.current?.();
      return true;
    });
  }, []);

  const dismiss = useCallback(() => {
    setRevealed((wasRevealed) => {
      if (wasRevealed) onDismissRef.current?.();
      return false;
    });
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || e.pointerType === 'mouse') return;
      if (revealed) dismiss();
      else reveal();
    },
    [enabled, revealed, reveal, dismiss],
  );

  useEffect(() => {
    if (!revealed || typeof document === 'undefined') return;
    const onDocDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      const inside = (refs ?? []).some((r) => r.current?.contains(target));
      if (!inside) dismiss();
    };
    // Defer so the revealing tap (already in flight) doesn't immediately dismiss.
    const id = setTimeout(() => document.addEventListener('pointerdown', onDocDown), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', onDocDown);
    };
  }, [revealed, refs, dismiss]);

  return { revealed, triggerProps: { onPointerDown }, reveal, dismiss };
}
