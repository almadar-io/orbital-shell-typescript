/**
 * Trait Registry - Tracks active traits and their state machines for debugging
 *
 * @packageDocumentation
 */

export interface TraitTransition {
  from: string;
  to: string;
  event: string;
  guard?: string;
}

export interface TraitGuard {
  name: string;
  lastResult?: boolean;
}

export interface TraitDebugInfo {
  id: string;
  name: string;
  currentState: string;
  states: string[];
  transitions: TraitTransition[];
  guards: TraitGuard[];
  transitionCount: number;
}

type ChangeListener = () => void;

/** What a reader of the registry gets for one trait, built when it is read: nothing is copied while nobody asks. */
export type TraitSource = () => TraitDebugInfo;

const sources = new Map<string, TraitSource>();
const listeners = new Set<ChangeListener>();

function notifyListeners(): void {
  listeners.forEach(listener => listener());
}

/** Registers `id` read from `source`; the returned function removes it (and only this registration). */
export function registerTraitSource(id: string, source: TraitSource): () => void {
  sources.set(id, source);
  notifyListeners();
  return () => {
    if (sources.get(id) !== source) return;
    sources.delete(id);
    notifyListeners();
  };
}

export function getAllTraits(): TraitDebugInfo[] {
  return Array.from(sources.values(), source => source());
}

export function getTrait(id: string): TraitDebugInfo | undefined {
  return sources.get(id)?.();
}

export function subscribeToTraitChanges(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearTraits(): void {
  sources.clear();
  notifyListeners();
}
