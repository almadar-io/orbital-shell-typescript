/**
 * Element picking for a state machine view: while active, the page outlines
 * the output of the trait under the pointer and a click picks that trait.
 * Only `pickable` traits count, the innermost one wins, and anything inside
 * `exclude` (the view itself) behaves as usual. The outlines come from the
 * trait presence registry, which marks a trait's output only while watched.
 */
import { useEffect, useState, type RefObject } from 'react';
import { boxesOf, getTraitPresence } from '../core';

export interface InspectedTrait {
  trait: string;
  rect: { left: number; top: number; width: number; height: number };
}

export interface TraitInspectorOptions {
  active: boolean;
  pickable: readonly string[];
  exclude: RefObject<Element | null>;
  onPick: (trait: string) => void;
  onCancel: () => void;
}

const MARK = 'data-trait-presence';

export function traitOutputAt(target: EventTarget | null, pickable: ReadonlySet<string>): Element | null {
  if (!(target instanceof Element)) return null;
  let el: Element | null = target.closest(`[${MARK}]`);
  while (el !== null) {
    const trait = el.getAttribute(MARK);
    if (trait !== null && pickable.has(trait)) return el;
    el = el.parentElement === null ? null : el.parentElement.closest(`[${MARK}]`);
  }
  return null;
}

export function outputRect(el: Element): InspectedTrait['rect'] | null {
  const rects = boxesOf(el).map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, width: right - left, height: bottom - top };
}

export function useTraitInspector({ active, pickable, exclude, onPick, onCancel }: TraitInspectorOptions): InspectedTrait | null {
  const [hovered, setHovered] = useState<InspectedTrait | null>(null);
  const key = pickable.join('\u0000');

  useEffect(() => {
    if (!active || typeof document === 'undefined') {
      setHovered(null);
      return undefined;
    }
    const names = key === '' ? [] : key.split('\u0000');
    const set = new Set(names);
    const release = getTraitPresence().watch(names);
    let current: Element | null = null;
    const inView = (target: EventTarget | null) => target instanceof Node && exclude.current !== null && exclude.current.contains(target);
    const show = (el: Element | null) => {
      current = el;
      const trait = el?.getAttribute(MARK) ?? null;
      const rect = el === null ? null : outputRect(el);
      setHovered(trait === null || rect === null ? null : { trait, rect });
    };
    const onMove = (e: PointerEvent) => show(inView(e.target) ? null : traitOutputAt(e.target, set));
    const swallow = (e: Event) => {
      if (inView(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      if (inView(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const trait = traitOutputAt(e.target, set)?.getAttribute(MARK) ?? null;
      if (trait !== null) onPick(trait);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    const onScroll = () => show(current);
    const root = document.documentElement;
    const cursor = root.style.cursor;
    root.style.cursor = 'crosshair';
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerdown', swallow, true);
    document.addEventListener('mousedown', swallow, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      root.style.cursor = cursor;
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerdown', swallow, true);
      document.removeEventListener('mousedown', swallow, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      release();
      setHovered(null);
    };
  }, [active, key, exclude, onPick, onCancel]);

  return hovered;
}
