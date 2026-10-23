import { normalizeEventKey, LIFECYCLE_EVENTS } from '@almadar/core';

// src/client/state-book.ts
function findInitialState(trait) {
  const markedInitial = trait.states?.find((s) => s.isInitial)?.name;
  return markedInitial ?? trait.states?.[0]?.name ?? "unknown";
}
function createInitialTraitState(trait) {
  return {
    traitName: trait.name,
    currentState: findInitialState(trait),
    previousState: null,
    lastEvent: null,
    context: {}
  };
}
function findMatchingTransitions(trait, currentState, eventKey, eventId) {
  return (trait.transitions ?? []).filter((t) => {
    const fromMatches = Array.isArray(t.from) ? t.from.includes(currentState) : t.from === currentState;
    if (!fromMatches) return false;
    if (eventId && t.eventId) return t.eventId === eventId;
    return t.event === eventKey;
  });
}
function findTransition(trait, currentState, eventKey, eventId) {
  return findMatchingTransitions(trait, currentState, eventKey, eventId)[0];
}
var SINGLETON_SCOPE = "__singleton__";
var key = (traitName, entityId) => `${traitName}::${entityId ?? SINGLETON_SCOPE}`;
var StateBook = class {
  constructor(traits = [], observer) {
    this.observer = observer;
    for (const trait of traits) this.traits.set(trait.name, trait);
  }
  observer;
  traits = /* @__PURE__ */ new Map();
  states = /* @__PURE__ */ new Map();
  /** The trait's state, its initial state until the kernel reports one; `undefined` for a trait not on the page. */
  getState(traitName, entityId) {
    const recorded = this.states.get(key(traitName, entityId));
    if (recorded !== void 0) return recorded;
    const trait = this.traits.get(traitName);
    return trait === void 0 ? void 0 : createInitialTraitState(trait);
  }
  /** Each trait's singleton-scope state. */
  getAllStates() {
    const out = /* @__PURE__ */ new Map();
    for (const name of this.traits.keys()) {
      const state = this.getState(name);
      if (state !== void 0) out.set(name, state);
    }
    return out;
  }
  /** Whether the trait has an arm on the event from its current state. */
  canHandleEvent(traitName, eventKey, entityId, eventId) {
    const trait = this.traits.get(traitName);
    const state = this.getState(traitName, entityId);
    if (trait === void 0 || state === void 0) return false;
    return findTransition(trait, state.currentState, normalizeEventKey(eventKey), eventId) !== void 0;
  }
  /**
   * The lifecycle event an embedded child can be repainted with: the one it handles from its current state,
   * provided every matching arm stays in that state and only renders.
   */
  repaintLifecycleEvent(traitName, entityId) {
    const trait = this.traits.get(traitName);
    const state = this.getState(traitName, entityId);
    if (trait === void 0 || state === void 0) return void 0;
    for (const event of LIFECYCLE_EVENTS) {
      const arms = findMatchingTransitions(trait, state.currentState, event);
      if (arms.length === 0) continue;
      const repaints = arms.every((t) => t.to === state.currentState && (t.effects ?? []).every((effect) => Array.isArray(effect) && effect[0] === "render-ui"));
      return repaints ? event : void 0;
    }
    return void 0;
  }
  /** Record the state the kernel reports. No-op for a trait not on the page. */
  seedState(traitName, currentState, entityId) {
    const trait = this.traits.get(traitName);
    if (trait === void 0) return;
    const existing = this.states.get(key(traitName, entityId)) ?? createInitialTraitState(trait);
    this.states.set(key(traitName, entityId), { ...existing, currentState, previousState: existing.currentState });
  }
  /** Undo an optimistic commit, reporting the hop back to the observer. */
  rollbackState(traitName, toState, entityId, cause) {
    const from = this.getState(traitName, entityId)?.currentState;
    this.seedState(traitName, toState, entityId);
    if (from !== void 0 && from !== toState) this.observer?.onRollback?.({ traitName, from, to: toState, cause });
  }
};

export { StateBook, createInitialTraitState, findInitialState, findMatchingTransitions, findTransition };
