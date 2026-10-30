/**
 * Which traits have rendered output on screen — what a `[visible]` tick asks
 * before it fires (LOLO §11). A trait is `absent` when nothing it renders is
 * mounted, `on-screen` when any of its output is near the viewport in a
 * visible tab, and `off-screen` otherwise.
 *
 * Only watched traits are tracked: `TraitScopeProvider` wraps a trait's output
 * in a layout-neutral `display: contents` element only while some tick runner
 * watches that trait, so programs without `[visible]` ticks render unchanged.
 */
import type { TraitSurface } from '@almadar/core/kernel-wire';

export type TraitPresenceState = 'absent' | 'on-screen' | 'off-screen';

export interface TraitPresence {
  /** Ask for these traits' output to be tracked; returns the release. */
  watch(traits: readonly string[]): () => void;
  isWatched(trait: string): boolean;
  /** Notified when the watched set changes. */
  subscribe(listener: () => void): () => void;
  /** Track `wrapper`'s rendered boxes as `trait`'s output; returns the detach. */
  attach(trait: string, wrapper: Element): () => void;
  /** The presence of a group: on screen when any member is, absent when no member renders. */
  state(traits: readonly string[]): TraitPresenceState;
}

const NEAR_VIEWPORT = '200px';

/** The element boxes a wrapper renders, looking through `display: contents` layers. */
function boxesOf(el: Element): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(el.children)) {
    if (getComputedStyle(child).display === 'contents') out.push(...boxesOf(child));
    else out.push(child);
  }
  return out;
}

export function createTraitPresence(): TraitPresence {
  const watched = new Map<string, number>();
  const listeners = new Set<() => void>();
  const intersecting = new Map<Element, boolean>();
  const outputs = new Map<string, Set<Element>>();
  let observer: IntersectionObserver | null = null;

  const io = (): IntersectionObserver | null => {
    if (observer !== null || typeof IntersectionObserver === 'undefined') return observer;
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) intersecting.set(entry.target, entry.isIntersecting);
    }, { rootMargin: NEAR_VIEWPORT });
    return observer;
  };
  const notify = (): void => { listeners.forEach((l) => l()); };

  return {
    watch(traits) {
      for (const t of traits) watched.set(t, (watched.get(t) ?? 0) + 1);
      notify();
      return () => {
        for (const t of traits) {
          const n = (watched.get(t) ?? 0) - 1;
          if (n > 0) watched.set(t, n);
          else watched.delete(t);
        }
        notify();
      };
    },
    isWatched: (trait) => watched.has(trait),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    attach(trait, wrapper) {
      const own = new Set<Element>();
      const all = outputs.get(trait) ?? new Set<Element>();
      outputs.set(trait, all);
      const sync = (): void => {
        const next = new Set(boxesOf(wrapper));
        for (const el of own) {
          if (next.has(el)) continue;
          own.delete(el); all.delete(el); intersecting.delete(el); io()?.unobserve(el);
        }
        for (const el of next) {
          if (own.has(el)) continue;
          own.add(el); all.add(el); io()?.observe(el);
        }
      };
      sync();
      const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(sync);
      mutations?.observe(wrapper, { childList: true });
      return () => {
        mutations?.disconnect();
        for (const el of own) { all.delete(el); intersecting.delete(el); io()?.unobserve(el); }
        own.clear();
        if (all.size === 0) outputs.delete(trait);
      };
    },
    state(traits) {
      let rendered = false;
      for (const t of traits) {
        const els = outputs.get(t);
        if (els === undefined || els.size === 0) continue;
        rendered = true;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') continue;
        for (const el of els) if (intersecting.get(el) === true) return 'on-screen';
      }
      return rendered ? 'off-screen' : 'absent';
    },
  };
}

let documentPresence: TraitPresence | null = null;

/** The one presence registry for this document. */
export function getTraitPresence(): TraitPresence {
  documentPresence ??= createTraitPresence();
  return documentPresence;
}

/** The traits whose output decides `traitName`'s presence: itself, or every trait sharing its `[shared]` entity's frame (LOLO §11). */
export function presenceGroup(traitIndex: { byName: ReadonlyMap<string, Pick<TraitSurface, 'shared' | 'frameKey'>> }, traitName: string): string[] {
  const entry = traitIndex.byName.get(traitName);
  if (entry === undefined || !entry.shared) return [traitName];
  return [...traitIndex.byName].filter(([, e]) => e.frameKey === entry.frameKey).map(([name]) => name);
}
