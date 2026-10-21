/**
 * Item movement — a row that changes place glides from where it was to where
 * it is now (FLIP), instead of vanishing and reappearing. One scope remembers
 * every row's last position in its container by id; a DataGrid opens a scope its nested
 * lists share, so a card that leaves one column and mounts in another glides
 * across. Off when the theme sets `--motion-enable: off` or the OS asks for
 * reduced motion; timing is the theme's `--duration-slow` / `--easing-emphasized`.
 */
import { createContext, useContext, useId, useLayoutEffect, useRef } from "react";
import { layoutScale, motionTiming } from '../core';

interface Point {
  x: number;
  y: number;
}

/** A glide in flight: it eases the row from `to + offset` back to `to`. */
interface Flight {
  glide: Animation;
  to: Point;
  offset: Point;
}

interface ItemMoveScope {
  id: string;
  /** Each row's resting place in the container, by id. */
  last: Map<string, Point>;
  /** Each row's glide in flight, by id: a row that remounts in another list keeps it. */
  flights: Map<string, Flight>;
  /** Each row's laid-out height and the height ease in flight, by id. */
  heights: Map<string, number>;
  resizes: Map<string, Resize>;
}

const ItemMoveScopeContext = createContext<ItemMoveScope | null>(null);

export const ItemMoveScopeProvider = ItemMoveScopeContext.Provider;

/** A fresh scope, for a container whose nested lists move rows between each other. */
export function useNewItemMoveScope(): ItemMoveScope {
  const id = useId();
  const last = useRef(new Map<string, Point>()).current;
  const flights = useRef(new Map<string, Flight>()).current;
  const heights = useRef(new Map<string, number>()).current;
  const resizes = useRef(new Map<string, Resize>()).current;
  return { id, last, flights, heights, resizes };
}

/** Where a glide in flight shows its row now, or undefined once it has landed. */
function inFlight(flight: Flight | undefined): Point | undefined {
  if (flight === undefined || flight.glide.playState !== "running") return undefined;
  const progress = Number(flight.glide.effect?.getComputedTiming().progress ?? 1);
  if (!(progress < 1)) return undefined;
  return { x: flight.to.x + flight.offset.x * (1 - progress), y: flight.to.y + flight.offset.y * (1 - progress) };
}

const near = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/** A height ease in flight: the row goes from `from` to `to` px. */
interface Resize {
  glide: Animation;
  from: number;
  to: number;
}

/**
 * A row whose own height changed eases from the height it showed to its new one. Measuring
 * needs the ease off; when the target is unchanged it resumes where it was.
 */
function easeHeight(scope: ItemMoveScope, id: string, el: HTMLElement, timing: { duration: number; easing: string }, scale: number): void {
  const running = scope.resizes.get(id);
  const live = running !== undefined && running.glide.playState === "running" ? running : undefined;
  const shown = el.getBoundingClientRect().height / scale;
  const elapsed = live?.glide.currentTime ?? null;
  live?.glide.cancel();
  scope.resizes.delete(id);
  const height = el.getBoundingClientRect().height / scale;
  const resume = live !== undefined && Math.abs(live.to - height) < 1;
  const from = resume ? live.from : live !== undefined ? shown : scope.heights.get(id);
  scope.heights.set(id, height);
  if (from === undefined || Math.abs(from - height) < 1) return;
  const glide = el.animate([{ height: `${from}px`, overflow: "clip" }, { height: `${height}px`, overflow: "clip" }], timing);
  if (glide === undefined) return;
  if (resume && elapsed !== null) glide.currentTime = elapsed;
  scope.resizes.set(id, { glide, from, to: height });
}

function glideMoved(scope: ItemMoveScope): void {
  const container = document.querySelector(`[data-item-move-root="${scope.id}"]`);
  if (container === null) return;
  const rows = container.querySelectorAll<HTMLElement>(`[data-item-move="${scope.id}"][data-item-key]`);
  const timing = motionTiming("--duration-slow", "--easing-emphasized", container);
  const origin = container.getBoundingClientRect();
  const scale = layoutScale(container);
  for (const el of rows) {
    const id = el.getAttribute("data-item-key");
    if (id === null) continue;
    if (timing !== undefined) easeHeight(scope, id, el, timing, scale);
    const flight = scope.flights.get(id);
    const shown = inFlight(flight);
    // Measured at rest: a glide still on this element is offset by its current translate.
    const box = el.getBoundingClientRect();
    const onEl = shown !== undefined && flight !== undefined && el.getAnimations?.().includes(flight.glide) === true;
    const now = onEl && flight !== undefined
      ? { x: (box.left - origin.left) / scale - (shown.x - flight.to.x), y: (box.top - origin.top) / scale - (shown.y - flight.to.y) }
      : { x: (box.left - origin.left) / scale, y: (box.top - origin.top) / scale };
    // A re-render that leaves the row's destination unchanged lets its glide finish.
    if (shown !== undefined && flight !== undefined && near(now, flight.to)) {
      scope.last.set(id, now);
      continue;
    }
    const from = shown ?? scope.last.get(id);
    scope.last.set(id, now);
    flight?.glide.cancel();
    scope.flights.delete(id);
    if (timing === undefined || from === undefined || near(from, now)) continue;
    // The glide replaces the row's entrance: an arriving card moves, it does not appear.
    for (const entrance of el.getAnimations?.() ?? []) entrance.cancel();
    const offset = { x: from.x - now.x, y: from.y - now.y };
    const glide = el.animate([{ transform: `translate(${offset.x}px, ${offset.y}px)` }, { transform: "none" }], timing);
    if (glide !== undefined) scope.flights.set(id, { glide, to: now, offset });
  }
}

export interface ItemMoveAttrs {
  /** Each row's `data-item-move`, beside its `data-item-key` (its stable id): rows are found by both, so every list under one scope is measured together. */
  row: string | undefined;
  /** The container's `data-item-move-root` when this component owns its scope: positions are measured against it, so the whole list moving on the page is not a move. */
  root: string | undefined;
}

/** Glide this list's moved rows after every render. */
export function useItemMoves(enabled: boolean): ItemMoveAttrs {
  const parent = useContext(ItemMoveScopeContext);
  const own = useNewItemMoveScope();
  const scope = parent ?? own;
  useLayoutEffect(() => {
    if (enabled) glideMoved(scope);
  });
  return { row: enabled ? scope.id : undefined, root: enabled && parent === null ? own.id : undefined };
}
