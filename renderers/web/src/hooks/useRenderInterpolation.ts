'use client';
import { useRef, useEffect, useCallback } from 'react';

export interface Positioned {
  id: string;
  x: number;
  y: number;
}

interface Snapshot<T extends Positioned> {
  entities: readonly T[];
  arrivedAt: number;
}

export interface RenderInterpolationOptions {
  /** Expected tick interval in ms (default: 1000/30 ≈ 33.3ms) */
  tickIntervalMs?: number;
}

export interface RenderInterpolationHandle<T extends Positioned> {
  /** Call when a new authoritative snapshot arrives from the model */
  onSnapshot: (entities: readonly T[]) => void;
  /** Returns interpolated positions for the current rAF timestamp; falls back to authoritative values */
  getInterpolated: (now: number) => Map<string, { x: number; y: number }>;
  /** Start the rAF loop; call the supplied draw fn on every frame */
  startLoop: (draw: (positions: Map<string, { x: number; y: number }>) => void) => () => void;
}

/**
 * Fixed-timestep render interpolation between the last two authoritative model snapshots.
 *
 * Buffers two snapshots. On each rAF frame computes
 *   alpha = clamp((now - lastArrival) / tickIntervalMs, 0, 1)
 * and lerps x/y between prev and curr, matched by entity id.
 * New or removed entities fall back to their authoritative value directly.
 * Never throws; never causes a React re-render per frame.
 */
export function useRenderInterpolation<T extends Positioned>(
  options: RenderInterpolationOptions = {},
): RenderInterpolationHandle<T> {
  const tickIntervalMs = options.tickIntervalMs ?? (1000 / 30);

  const prevRef = useRef<Snapshot<T> | null>(null);
  const currRef = useRef<Snapshot<T> | null>(null);
  const rafRef = useRef<number | null>(null);

  const onSnapshot = useCallback((entities: readonly T[]) => {
    prevRef.current = currRef.current;
    currRef.current = { entities, arrivedAt: performance.now() };
  }, []);

  const getInterpolated = useCallback((now: number): Map<string, { x: number; y: number }> => {
    const out = new Map<string, { x: number; y: number }>();
    const curr = currRef.current;
    if (!curr) return out;

    const prev = prevRef.current;
    if (!prev) {
      for (const e of curr.entities) out.set(e.id, { x: e.x, y: e.y });
      return out;
    }

    const rawAlpha = (now - curr.arrivedAt) / tickIntervalMs;
    const alpha = rawAlpha < 0 ? 0 : rawAlpha > 1 ? 1 : rawAlpha;

    const prevMap = new Map<string, T>();
    for (const e of prev.entities) prevMap.set(e.id, e);

    for (const c of curr.entities) {
      const p = prevMap.get(c.id);
      if (!p) {
        out.set(c.id, { x: c.x, y: c.y });
      } else {
        out.set(c.id, {
          x: p.x + (c.x - p.x) * alpha,
          y: p.y + (c.y - p.y) * alpha,
        });
      }
    }
    return out;
  }, [tickIntervalMs]);

  const startLoop = useCallback(
    (draw: (positions: Map<string, { x: number; y: number }>) => void): (() => void) => {
      let active = true;
      const loop = () => {
        if (!active) return;
        try {
          draw(getInterpolated(performance.now()));
        } catch {
          // never block the loop
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      return () => {
        active = false;
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    },
    [getInterpolated],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return { onSnapshot, getInterpolated, startLoop };
}
