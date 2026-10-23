import { createLogger } from '@almadar/logger';

// src/events/EventBus.ts
var log = createLogger("almadar:runtime:eventbus");
var EventBus = class {
  listeners = /* @__PURE__ */ new Map();
  /** Maximum recursion depth before circuit breaker activates (RCG-05) */
  maxDepth;
  /** Current emission depth for circular loop detection */
  depth = 0;
  constructor(options = {}) {
    void options.debug;
    this.maxDepth = options.maxDepth ?? 10;
  }
  /**
   * Emit an event to all registered listeners.
   *
   * Includes circuit breaker (RCG-05): if emit is called recursively
   * beyond `maxDepth`, the event is dropped and an error is logged.
   * This prevents infinite loops from circular emit/listen chains.
   */
  emit(type, payload, source, routingKey) {
    if (this.depth >= this.maxDepth) {
      log.error("circular event loop dropped", { type, depth: this.depth, maxDepth: this.maxDepth });
      return;
    }
    const event = {
      type,
      payload,
      timestamp: Date.now(),
      source
    };
    const deliveryKey = routingKey ?? type;
    const primary = this.listeners.get(deliveryKey);
    const secondary = routingKey !== void 0 && routingKey !== type ? this.listeners.get(type) : void 0;
    const listenerCount = (primary?.size ?? 0) + (secondary?.size ?? 0);
    if (listenerCount > 0) {
      log.debug("emit", { type, listenerCount, depth: this.depth });
    } else {
      log.debug("emit no listeners", { type });
    }
    this.depth++;
    try {
      const delivered = /* @__PURE__ */ new Set();
      const deliverTo = (set) => {
        if (!set) return;
        for (const listener of Array.from(set)) {
          if (delivered.has(listener)) continue;
          delivered.add(listener);
          try {
            listener(event);
          } catch (error) {
            log.error("listener threw", { type, error: error instanceof Error ? error : String(error) });
          }
        }
      };
      deliverTo(primary);
      deliverTo(secondary);
      if (type !== "*") {
        const wildcardListeners = this.listeners.get("*");
        if (wildcardListeners) {
          for (const listener of Array.from(wildcardListeners)) {
            try {
              listener(event);
            } catch (error) {
              log.error("wildcard listener threw", { error: error instanceof Error ? error : String(error) });
            }
          }
        }
      }
    } finally {
      this.depth--;
    }
  }
  /**
   * Subscribe to an event type
   */
  on(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, /* @__PURE__ */ new Set());
    }
    const listeners = this.listeners.get(type);
    listeners.add(listener);
    log.debug("subscribe", { type, total: listeners.size });
    return () => {
      listeners.delete(listener);
      log.debug("unsubscribe", { type, remaining: listeners.size });
      if (listeners.size === 0) {
        this.listeners.delete(type);
      }
    };
  }
  /**
   * Subscribe to ALL events (wildcard listener)
   * Useful for event tracking, logging, debugging
   */
  onAny(listener) {
    return this.on("*", listener);
  }
  /**
   * Check if there are listeners for an event type
   */
  hasListeners(type) {
    const listeners = this.listeners.get(type);
    return listeners !== void 0 && listeners.size > 0;
  }
  /**
   * Get all registered event types
   */
  getRegisteredEvents() {
    return Array.from(this.listeners.keys());
  }
  /**
   * Clear all listeners
   */
  clear() {
    log.debug("clear", { eventTypeCount: this.listeners.size });
    this.listeners.clear();
  }
  /**
   * Get listener count for an event type (for testing)
   */
  getListenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
};
function createEventBus(options) {
  return new EventBus(options);
}

export { EventBus, createEventBus };
