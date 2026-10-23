import { StateBook } from './chunk-Q2H75UYT.js';
import { AwaitingRegistry } from './chunk-HC6ERSAH.js';

// src/client/circuit-store.ts
function createMemoryCircuitStore(traits = [], observer) {
  const states = new StateBook(traits, observer);
  const frames = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  let version = 0;
  return {
    states,
    frames,
    callsitePayloads: /* @__PURE__ */ new Map(),
    awaiting: new AwaitingRegistry(),
    snapshot(trait, entityId, frameKey) {
      const key = frameKey ?? trait;
      const frame = frames.get(key);
      return {
        state: states.getState(trait, entityId)?.currentState ?? "",
        frame: frame !== void 0 ? { ...frame } : void 0
      };
    },
    restore(trait, entityId, snap, frameKey, cause) {
      const key = frameKey ?? trait;
      if (snap.state !== "") {
        states.rollbackState(trait, snap.state, entityId, cause);
      }
      if (snap.frame === void 0) {
        frames.delete(key);
      } else {
        frames.set(key, { ...snap.frame });
      }
    },
    notify() {
      version += 1;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion() {
      return version;
    }
  };
}

export { createMemoryCircuitStore };
