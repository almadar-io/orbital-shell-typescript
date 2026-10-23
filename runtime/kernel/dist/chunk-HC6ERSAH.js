// src/client/awaiting.ts
var AwaitingRegistry = class {
  entries = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Map();
  anyListeners = /* @__PURE__ */ new Set();
  version = 0;
  begin(list) {
    for (const entry of list) {
      this.entries.set(entry.trait, entry);
      this.emit(entry.trait);
    }
  }
  end(traits) {
    for (const trait of traits) {
      if (!this.entries.delete(trait)) continue;
      this.emit(trait);
    }
  }
  get(trait) {
    return this.entries.get(trait);
  }
  list() {
    return [...this.entries.values()];
  }
  subscribe(trait, listener) {
    let set = this.listeners.get(trait);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(trait, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) this.listeners.delete(trait);
    };
  }
  /** Any trait's awaiting change (an empty slot does not know which trait will fill it). */
  subscribeAll(listener) {
    this.anyListeners.add(listener);
    return () => {
      this.anyListeners.delete(listener);
    };
  }
  /** Bumped on every change — a stable snapshot key for `useSyncExternalStore`. */
  getVersion() {
    return this.version;
  }
  emit(trait) {
    this.version += 1;
    this.listeners.get(trait)?.forEach((listener) => listener());
    this.anyListeners.forEach((listener) => listener());
  }
};

export { AwaitingRegistry };
