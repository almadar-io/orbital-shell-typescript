import React from "react";

const CLICK_SLOP_PX = 4;
const NOT_A_PAN = "[data-dnd-item], button, a, input, textarea, select, label, [role='button'], [role='menuitem'], [contenteditable='true']";

/**
 * Hold the mouse on a sideways-scrolling strip's empty space and drag to pan it (Trello's board). A press on a card,
 * a control or a link is left to it, the wheel is left to the browser, and a touch or trackpad swipe scrolls natively.
 * Returns the ref callback for the strip.
 */
export function useDragScrollX(enabled: boolean): (strip: HTMLElement | null) => void {
  const [strip, setStrip] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!enabled || strip === null) return;
    const onDown = (down: MouseEvent) => {
      if (down.button !== 0) return;
      if (down.target instanceof Element && down.target.closest(NOT_A_PAN)) return;
      const startX = down.clientX;
      const startLeft = strip.scrollLeft;
      const snap = strip.style.scrollSnapType;
      let moved = false;
      const onMove = (move: MouseEvent) => {
        const dx = move.clientX - startX;
        if (!moved && Math.abs(dx) < CLICK_SLOP_PX) return;
        if (!moved) {
          moved = true;
          strip.style.scrollSnapType = "none";
          strip.style.cursor = "grabbing";
          strip.style.userSelect = "none";
        }
        strip.scrollLeft = startLeft - dx;
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (!moved) return;
        strip.style.scrollSnapType = snap;
        strip.style.cursor = "";
        strip.style.userSelect = "";
        const swallow = (click: MouseEvent) => {
          click.preventDefault();
          click.stopPropagation();
        };
        strip.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => strip.removeEventListener("click", swallow, { capture: true }), 0);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    strip.addEventListener("mousedown", onDown);
    return () => strip.removeEventListener("mousedown", onDown);
  }, [strip, enabled]);
  return setStrip;
}
