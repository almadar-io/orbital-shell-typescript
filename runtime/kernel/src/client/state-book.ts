/**
 * The client's record of each trait's state, as the kernel reports it. The kernel decides every transition;
 * this book only holds the states its responses carry, so a render can read them synchronously.
 *
 * @packageDocumentation
 */
import type { TraitDefinition } from '@almadar/core';
import type { RollbackCause, TraitState, TransitionObserver } from './trait-types.js';


/** The state a trait starts in: the one marked initial, else the first declared. */
export function findInitialState(trait: TraitDefinition): string {
  const markedInitial = trait.states?.find((s) => s.isInitial)?.name;
  return markedInitial ?? trait.states?.[0]?.name ?? 'unknown';
}

export function createInitialTraitState(trait: TraitDefinition): TraitState {
  return {
    traitName: trait.name,
    currentState: findInitialState(trait),
    previousState: null,
    lastEvent: null,
    context: {},
  };
}

const SINGLETON_SCOPE = '__singleton__';

const key = (traitName: string, entityId: string | undefined): string => `${traitName}::${entityId ?? SINGLETON_SCOPE}`;

export class StateBook {
  private readonly traits = new Map<string, TraitDefinition>();
  private readonly states = new Map<string, TraitState>();

  constructor(traits: readonly TraitDefinition[] = [], private readonly observer?: TransitionObserver) {
    for (const trait of traits) this.traits.set(trait.name, trait);
  }

  /** The trait's state, its initial state until the kernel reports one; `undefined` for a trait not on the page. */
  getState(traitName: string, entityId?: string): TraitState | undefined {
    const recorded = this.states.get(key(traitName, entityId));
    if (recorded !== undefined) return recorded;
    const trait = this.traits.get(traitName);
    return trait === undefined ? undefined : createInitialTraitState(trait);
  }

  /** Each trait's singleton-scope state. */
  getAllStates(): Map<string, TraitState> {
    const out = new Map<string, TraitState>();
    for (const name of this.traits.keys()) {
      const state = this.getState(name);
      if (state !== undefined) out.set(name, state);
    }
    return out;
  }

  /** Record the state the kernel reports. No-op for a trait not on the page. */
  seedState(traitName: string, currentState: string, entityId?: string): void {
    const trait = this.traits.get(traitName);
    if (trait === undefined) return;
    const existing = this.states.get(key(traitName, entityId)) ?? createInitialTraitState(trait);
    this.states.set(key(traitName, entityId), { ...existing, currentState, previousState: existing.currentState });
  }

  /** Undo an optimistic commit, reporting the hop back to the observer. */
  rollbackState(traitName: string, toState: string, entityId: string | undefined, cause: RollbackCause): void {
    const from = this.getState(traitName, entityId)?.currentState;
    this.seedState(traitName, toState, entityId);
    if (from !== undefined && from !== toState) this.observer?.onRollback?.({ traitName, from, to: toState, cause });
  }
}
