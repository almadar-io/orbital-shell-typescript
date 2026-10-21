'use client';
/**
 * EventBusProvider - React context provider for the event bus
 *
 * Provides a page-scoped event bus for trait communication.
 * Each page has its own event bus instance.
 *
 * NOTE: Selection state has been moved to SelectionProvider.
 * Use SelectionProvider for tracking selected entities.
 *
 * @packageDocumentation
 */

import React, { createContext, useCallback, useRef, useMemo, useEffect, type ReactNode } from 'react';
import type {
  BusEvent,
  BusEventSource,
  BusEventListener,
  Unsubscribe,
  EventBusContextType,
} from '../types/event-bus-types';
import type { EventPayload, EntityRow } from '@almadar/core';
import { setGlobalEventBus } from '../hooks/useEventBus';
import { createLogger } from '@almadar/logger';

const busLog = createLogger('almadar:eventbus');
const subLog = createLogger('almadar:eventbus:subscribe');

// ============================================================================
// Context
// ============================================================================

/**
 * Extended context type for backward compatibility.
 *
 * @deprecated getSelectedEntity and clearSelectedEntity are deprecated.
 * Use SelectionProvider and useSelection hook instead.
 */
export interface EventBusContextTypeExtended extends EventBusContextType {
  /** @deprecated Use useSelection from SelectionProvider instead. */
  getSelectedEntity: () => EntityRow | null;
  /** @deprecated Use useSelection from SelectionProvider instead. */
  clearSelectedEntity: () => void;
}

// Ambient global slot — see the singleton below. Declared the same way
// useEventBus.ts declares `Window.__kflowEventBus`, but on `globalThis` so it
// is reachable from every physical copy of this module regardless of which
// bundler chunk (or which duplicate `node_modules` install) it was loaded
// from.
declare global {
  var __almadarUiEventBusContext: React.Context<EventBusContextTypeExtended | null> | undefined;
}

// Context identity must survive module duplication: a consumer's bundler can
// pre-bundle this package's entry points into separate dep-optimizer chunks
// (or resolve a second physical install of the package altogether), each of
// which would otherwise run its own `createContext()` and produce a distinct
// Context object that `<EventBusProvider>` in one copy can never satisfy for
// a `useEventBus()` caller in another. Every copy of this module resolves
// through the SAME global slot instead, so identity holds no matter how many
// times the module itself is duplicated.
export const EventBusContext: React.Context<EventBusContextTypeExtended | null> =
  globalThis.__almadarUiEventBusContext ??
  (globalThis.__almadarUiEventBusContext = createContext<EventBusContextTypeExtended | null>(null));

// ============================================================================
// Provider Component
// ============================================================================

interface EventBusProviderProps {
  // Optional: createElement passes children positionally (see
  // TraitScopeProviderProps for the TS2769 rationale).
  children?: ReactNode;
  /**
   * @deprecated No-op. Logging is now gated by `@almadar/logger` —
   * use `setLogLevel('DEBUG')` or `setNamespaceLevel('almadar:eventbus', 'DEBUG')`
   * from `@almadar/logger` to control verbosity. Kept for API compatibility.
   */
  debug?: boolean;
  /**
   * When true, this provider does NOT register itself as the global event bus
   * (`window.__kflowEventBus`). Use for SANDBOXED subtrees — e.g. a studio
   * preview (`OrbPreview isolated`) embedded inside a host app — whose internal
   * events must stay context-local and must NOT clobber the host's global bus.
   * Children still get this bus via React context; only the global bridge is
   * skipped. Default false (root/standalone providers own the global bridge).
   */
  isolated?: boolean;
}

/**
 * Provider component for the page event bus.
 *
 * This is a pure pub/sub event bus. For selection state,
 * use SelectionProvider which listens to events and maintains state.
 *
 * @example
 * ```tsx
 * function TaskDetailPage() {
 *   return (
 *     <EventBusProvider debug={process.env.NODE_ENV === 'development'}>
 *       <SelectionProvider>
 *         <TaskHeader />
 *         <TaskForm />
 *         <TaskActions />
 *       </SelectionProvider>
 *     </EventBusProvider>
 *   );
 * }
 * ```
 */
// Per-listener identity tags. Captured at subscribe-time from the call
// stack so we can answer "who reacted to this emit?" without renaming
// every subscriber. Used by the per-listener emit log below.
const listenerTags = new WeakMap<BusEventListener, string>();
function captureSubscriberTag(listener: BusEventListener): string {
    // Prefer the listener's function.name (preserved through bundling
    // when the source declares a named function or assigns a name via
    // `Object.defineProperty(fn, 'name', ...)` — much more durable
    // than stack frames against minified code).
    const fnName = (listener as { name?: string }).name;
    if (typeof fnName === 'string' && fnName.length > 0 && fnName !== 'listener') {
        return fnName;
    }
    // Fallback: pull out the first stack frame that lives in user code
    // (skip the hook/provider frames). Browser stacks vary, so we keep
    // the shortest identifying suffix and trim node_modules noise.
    const stack = new Error().stack ?? '';
    const lines = stack.split('\n');
    for (const raw of lines.slice(2)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.includes('EventBusProvider') || line.includes('useEventBus')) continue;
        if (line.includes('captureSubscriberTag')) continue;
        // Drop verbose path prefixes; keep filename:line if available.
        const match = line.match(/([^/\\)]+\.(?:tsx?|jsx?))(?::(\d+))?/);
        if (match) return match[2] ? `${match[1]}:${match[2]}` : match[1];
        return line.slice(0, 120);
    }
    return 'unknown';
}

export function EventBusProvider({ children, isolated = false }: EventBusProviderProps) {
  // Store listeners by event type
  const listenersRef = useRef<Map<string, Set<BusEventListener>>>(new Map());

  // Store wildcard listeners (onAny)
  const anyListenersRef = useRef<Set<BusEventListener>>(new Set());

  // Track if deprecation warning has been shown
  const deprecationWarningShown = useRef(false);

  /**
   * @deprecated Use useSelection from SelectionProvider instead.
   */
  const getSelectedEntity = useCallback(() => {
    if (!deprecationWarningShown.current) {
      busLog.warn('deprecated:getSelectedEntity', {
        migration: 'Use SelectionProvider and useSelection hook instead. See SelectionProvider.tsx for migration guide.',
      });
      deprecationWarningShown.current = true;
    }
    return null;
  }, []);

  /**
   * @deprecated Use useSelection from SelectionProvider instead.
   */
  const clearSelectedEntity = useCallback(() => {
    if (!deprecationWarningShown.current) {
      busLog.warn('deprecated:clearSelectedEntity', {
        migration: 'Use SelectionProvider and useSelection hook instead. See SelectionProvider.tsx for migration guide.',
      });
      deprecationWarningShown.current = true;
    }
  }, []);

  /**
   * Emit an event to all listeners of that type.
   */
  const emit = useCallback((type: string, payload?: EventPayload, source?: BusEventSource) => {
    const event: BusEvent = {
      type,
      payload,
      timestamp: Date.now(),
      source,
    };

    const listeners = listenersRef.current.get(type);
    const listenerCount = (listeners?.size ?? 0) + anyListenersRef.current.size;
    busLog.debug('emit', { type, payloadKeys: payload ? Object.keys(payload).length : 0, listenerCount });
    if (listenerCount === 0) {
      // DEBUG (not WARN): a zero-subscriber emit is a routing diagnostic, not
      // an actionable warning — tick/internal events commonly have no runtime
      // listener and WARN floods the console. Gate it behind the
      // `almadar:eventbus` namespace; real orphan emits are caught by the
      // closed-circuit validator, not at runtime.
      busLog.debug('emit:no-listeners', { type });
    }

    // Per-listener invocation log. The summary `emit` line above only
    // tells us how MANY listeners ran; the slot-render investigation
    // needs to know WHICH listeners reacted to a specific event (e.g.
    // UI:FIELD_CHANGED) to identify whether any of them indirectly
    // re-render the slot tree mid-edit. Tagged at subscribe-time via
    // captureSubscriberTag so anonymous arrow-function listeners are
    // still distinguishable.
    if (listeners) {
      // Create a copy to avoid issues if listener modifies the set
      const listenersCopy = Array.from(listeners);
      for (let i = 0; i < listenersCopy.length; i++) {
        const listener = listenersCopy[i];
        busLog.debug('emit:listener', {
          type,
          kind: 'specific',
          index: i,
          tag: listenerTags.get(listener) ?? 'untagged',
        });
        try {
          listener(event);
        } catch (error) {
          busLog.error('listener-threw', { type, error: error instanceof Error ? error : String(error) });
        }
      }
    }

    // Notify wildcard (onAny) listeners
    const anyListeners = Array.from(anyListenersRef.current);
    for (let i = 0; i < anyListeners.length; i++) {
      const listener = anyListeners[i];
      busLog.debug('emit:listener', {
        type,
        kind: 'onAny',
        index: i,
        tag: listenerTags.get(listener) ?? 'untagged',
      });
      try {
        listener(event);
      } catch (error) {
        busLog.error('onAny-listener-threw', { type, error: error instanceof Error ? error : String(error) });
      }
    }
  }, []);

  /**
   * Subscribe to an event type.
   * Returns an unsubscribe function.
   */
  const on = useCallback((type: string, listener: BusEventListener): Unsubscribe => {
    if (!listenersRef.current.has(type)) {
      listenersRef.current.set(type, new Set());
    }

    const listeners = listenersRef.current.get(type)!;
    listeners.add(listener);
    if (!listenerTags.has(listener)) listenerTags.set(listener, captureSubscriberTag(listener));
    subLog.debug('subscribe', { type, totalListeners: listeners.size, tag: listenerTags.get(listener) });

    return () => {
      listeners.delete(listener);
      subLog.debug('unsubscribe', { type, remaining: listeners.size });
      if (listeners.size === 0) {
        listenersRef.current.delete(type);
      }
    };
  }, []);

  /**
   * Subscribe to an event type, but only fire once.
   */
  const once = useCallback((type: string, listener: BusEventListener): Unsubscribe => {
    const wrappedListener: BusEventListener = (event) => {
      // Remove self before calling listener
      listenersRef.current.get(type)?.delete(wrappedListener);
      listener(event);
    };

    return on(type, wrappedListener);
  }, [on]);

  /**
   * Check if there are any listeners for an event type.
   */
  const hasListeners = useCallback((type: string): boolean => {
    const listeners = listenersRef.current.get(type);
    return listeners !== undefined && listeners.size > 0;
  }, []);

  /**
   * Subscribe to ALL events regardless of type.
   */
  const onAny = useCallback((listener: BusEventListener): Unsubscribe => {
    anyListenersRef.current.add(listener);
    if (!listenerTags.has(listener)) listenerTags.set(listener, captureSubscriberTag(listener));
    subLog.debug('subscribe:any', { totalAnyListeners: anyListenersRef.current.size, tag: listenerTags.get(listener) });

    return () => {
      anyListenersRef.current.delete(listener);
      subLog.debug('unsubscribe:any', { remaining: anyListenersRef.current.size });
    };
  }, []);

  // Memoize context value
  const contextValue = useMemo(
    () => ({
      emit,
      on,
      once,
      hasListeners,
      onAny,
      getSelectedEntity,
      clearSelectedEntity,
    }),
    [emit, on, once, hasListeners, onAny, getSelectedEntity, clearSelectedEntity]
  );

  // Bridge to global event bus system.
  // Components in other packages (like shell components) use their own useEventBus hook
  // which checks for a global event bus. Setting it here allows shell components to
  // emit events to the same bus that the main app's trait state machine listens to.
  //
  // ISOLATED providers (e.g. a studio preview sandbox embedded in a host app)
  // skip this — registering would clobber the host's global bus, so a host
  // component that falls back to the global (e.g. one bundled from a different
  // @almadar/ui entry, with no matching React context) would emit into the
  // sandbox instead of the host. The sandbox's children still get this bus via
  // context above; only the global bridge is withheld.
  useEffect(() => {
    if (isolated) return;
    setGlobalEventBus(contextValue);
    return () => {
      setGlobalEventBus(null);
    };
  }, [contextValue, isolated]);

  return (
    <EventBusContext.Provider value={contextValue}>
      {children}
    </EventBusContext.Provider>
  );
}

export type { EventBusContextType };
