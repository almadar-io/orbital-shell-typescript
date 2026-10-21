/**
 * Changes inside a container ease in instead of switching in one frame: an
 * element that appears fades and rises in, text that changes in place fades
 * in on its element, blocks the change pushed glide to their new place, and the
 * container's own height eases to fit its new content. Rows with their own motion (item glides, entrance classes) are left alone. Timing is the theme's `--duration-normal` /
 * `--easing-emphasized`; off under reduced motion.
 */
import { useEffect, type RefObject } from "react";
import { layoutScale, motionTiming } from "./motion-tokens";

function ownMotion(el: Element): boolean {
  return el.closest("[data-item-move]") !== null || /\balmadar-enter-/.test(el.getAttribute("class") ?? "");
}

/** The element itself, or for a `display: contents` wrapper (no box to fade or resize) the nearest boxes inside it. */
function boxesOf(el: Element): Element[] {
  return getComputedStyle(el).display === "contents" ? boxedChildren(el) : [el];
}

/** The nearest descendants that lay out a box. */
function boxedChildren(el: Element): Element[] {
  return [...el.children].flatMap(boxesOf);
}

/** Typography the ghost copies so the old text looks exactly like it did. */
const GHOST_STYLE = ["font", "letterSpacing", "lineHeight", "color", "textAlign", "whiteSpace", "textTransform"] as const;

/**
 * Text that changed in a text-only element rolls: a ghost of the old text, laid over the
 * element on `document.body` (outside React's tree), slides up and out while the new text
 * slides up and in.
 */
function roll(el: HTMLElement, oldText: string, timing: { duration: number; easing: string }): void {
  const box = el.getBoundingClientRect();
  const scale = layoutScale(el);
  const computed = getComputedStyle(el);
  // Laid out at the element's own size, then scaled like the frame it sits in.
  const holder = document.createElement("span");
  holder.setAttribute("aria-hidden", "true");
  Object.assign(holder.style, {
    position: "fixed",
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width / scale}px`,
    height: `${box.height / scale}px`,
    transform: scale === 1 ? "" : `scale(${scale})`,
    transformOrigin: "top left",
    pointerEvents: "none",
    zIndex: "2147483647",
  });
  const ghost = document.createElement("span");
  ghost.setAttribute("data-change-ghost", "");
  ghost.setAttribute("aria-hidden", "true");
  ghost.textContent = oldText;
  for (const prop of GHOST_STYLE) ghost.style[prop] = computed[prop];
  Object.assign(ghost.style, { display: "block", width: "100%", height: "100%", overflow: "visible" });
  holder.appendChild(ghost);
  document.body.appendChild(holder);
  // Out, then in: the old text is gone by the half so the two never read on top of each other.
  const out = ghost.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-40%)", offset: 0.5 }, { opacity: 0, transform: "translateY(-40%)" }],
    timing,
  );
  if (out === undefined) holder.remove();
  else {
    out.addEventListener("finish", () => holder.remove());
    out.addEventListener("cancel", () => holder.remove());
  }
  el.animate(
    [{ opacity: 0, transform: "translateY(40%)" }, { opacity: 0, transform: "translateY(40%)", offset: 0.4 }, { opacity: 1, transform: "none" }],
    timing,
  );
}

const textOnly = (el: Element): el is HTMLElement =>
  el instanceof HTMLElement && el.childNodes.length > 0 && [...el.childNodes].every((n) => n.nodeType === Node.TEXT_NODE);

function settle(root: Element, added: Set<Element>, changed: Map<Element, string | undefined>): void {
  const timing = motionTiming("--duration-normal", "--easing-emphasized", root);
  if (timing === undefined) return;
  for (const el of added) {
    if (ownMotion(el) || (el.parentElement !== null && [...added].some((other) => other !== el && other.contains(el)))) continue;
    for (const box of boxesOf(el)) {
      if (ownMotion(box)) continue;
      box.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], timing);
    }
  }
  for (const [el, oldText] of changed) {
    if (ownMotion(el) || [...added].some((a) => a.contains(el))) continue;
    if (oldText !== undefined && oldText !== el.textContent && textOnly(el)) roll(el, oldText, timing);
    else el.animate([{ opacity: 0.25 }, { opacity: 1 }], timing);
  }
}

interface Point {
  x: number;
  y: number;
}

/** The boxes of the patterns rendered inside the container, outermost first; rows that glide on their own are left out. */
function blocks(root: Element): Element[] {
  const seen = new Set<Element>();
  for (const wrapper of root.querySelectorAll("[data-pattern]")) {
    for (const box of boxesOf(wrapper)) if (!ownMotion(box)) seen.add(box);
  }
  return [...seen];
}

/**
 * Blocks a change pushed glide from where they were. Positions are on-screen offsets from
 * the container, converted per block to its own layout pixels; a block already animating is neither glided nor remembered, so the next
 * change measures it at rest. A block moving with an ancestor that glides moves once.
 */
function glidePushed(root: Element, places: Map<Element, Point>): void {
  const timing = motionTiming("--duration-normal", "--easing-emphasized", root);
  const origin = root.getBoundingClientRect();
  const applied = new Map<Element, Point>();
  const present = new Set<Element>();
  for (const el of blocks(root)) {
    present.add(el);
    if ((el.getAnimations?.() ?? []).length > 0) {
      places.delete(el);
      continue;
    }
    const box = el.getBoundingClientRect();
    // On-screen offsets; each block converts its own move to layout pixels (it may sit in a scaled frame).
    const now = { x: box.left - origin.left, y: box.top - origin.top };
    const was = places.get(el);
    places.set(el, now);
    if (was === undefined || timing === undefined) continue;
    let inherited: Point = { x: 0, y: 0 };
    for (let up = el.parentElement; up !== null && up !== root; up = up.parentElement) {
      const a = applied.get(up);
      if (a !== undefined) {
        inherited = a;
        break;
      }
    }
    const dx = was.x - now.x - inherited.x;
    const dy = was.y - now.y - inherited.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      if (inherited.x !== 0 || inherited.y !== 0) applied.set(el, inherited);
      continue;
    }
    const scale = layoutScale(el);
    el.animate([{ transform: `translate(${dx / scale}px, ${dy / scale}px)` }, { transform: "none" }], { ...timing, composite: "add" });
    applied.set(el, { x: inherited.x + dx, y: inherited.y + dy });
  }
  for (const el of places.keys()) if (!present.has(el)) places.delete(el);
}

/**
 * Ease the container's height when its content resizes. Its children are watched, not the
 * container, so its own animated height never reports back as a content change.
 */
function easeHeight(root: HTMLElement): () => void {
  if (typeof ResizeObserver === "undefined") return () => undefined;
  let rest: number | undefined;
  let glide: Animation | undefined;
  const sizes = new ResizeObserver(() => {
    const scale = layoutScale(root);
    const shown = root.getBoundingClientRect().height / scale;
    const gliding = glide !== undefined && glide.playState === "running";
    glide?.cancel();
    glide = undefined;
    const height = root.getBoundingClientRect().height / scale;
    const from = gliding ? shown : rest;
    rest = height;
    const timing = motionTiming("--duration-normal", "--easing-emphasized", root);
    if (from === undefined || timing === undefined || Math.abs(from - height) < 1) return;
    glide = root.animate(
      [{ height: `${from}px`, overflow: "clip" }, { height: `${height}px`, overflow: "clip" }],
      timing,
    ) ?? undefined;
  });
  let watched: Element[] = [];
  const watch = () => {
    const next = boxedChildren(root);
    if (next.length === watched.length && next.every((el, i) => el === watched[i])) return;
    watched = next;
    sizes.disconnect();
    for (const el of next) sizes.observe(el);
  };
  watch();
  const children = new MutationObserver(watch);
  children.observe(root, { childList: true, subtree: true });
  return () => {
    children.disconnect();
    sizes.disconnect();
  };
}

export function useAnimateChanges(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const root = ref.current;
    if (!enabled || root === null) return;
    return easeHeight(root);
  }, [ref, enabled]);
  useEffect(() => {
    const root = ref.current;
    if (!enabled || root === null || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver((records) => {
      const added = new Set<Element>();
      // Each changed element with the text it showed before this batch (when known).
      const changed = new Map<Element, string | undefined>();
      for (const record of records) {
        if (record.type === "childList") {
          for (const node of record.addedNodes) {
            if (node instanceof Element) added.add(node);
            else if (node.nodeType === Node.TEXT_NODE && node.parentElement !== null && changed.get(node.parentElement) === undefined) {
              // A replaced text node: its old text is in the same record's removed text nodes.
              const removed = [...record.removedNodes].filter((n) => n.nodeType === Node.TEXT_NODE);
              changed.set(node.parentElement, removed.length > 0 ? removed.map((n) => n.textContent ?? "").join("") : undefined);
            }
          }
        } else if (record.type === "characterData") {
          const el = record.target.parentElement;
          if (el === null || changed.get(el) !== undefined) continue;
          // The element's text before this change: this node's old value, its siblings as they are.
          changed.set(el, [...el.childNodes].map((n) => (n === record.target ? record.oldValue ?? "" : n.textContent ?? "")).join(""));
        }
      }
      glidePushed(root, places);
      settle(root, added, changed);
    });
    const places = new Map<Element, Point>();
    glidePushed(root, places);
    observer.observe(root, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
    return () => observer.disconnect();
  }, [ref, enabled]);
}
