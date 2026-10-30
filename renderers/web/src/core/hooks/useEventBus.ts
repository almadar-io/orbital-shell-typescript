'use client';
/**
 * useEventBus Hook
 *
 * Provides event bus utilities for component communication.
 * This connects to the EventBusProvider for real applications
 * or provides a simple in-memory bus for design system / Storybook.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useContext } from 'react';
import { EventBusContext } from '../providers/EventBusProvider';
import { useTraitScopeChain } from '../providers/TraitScopeProvider';
import type {
  BusEvent,
  BusEventSource,
  BusEventListener,
  Unsubscribe,
  EventBusContextType,
} from '../types/event-bus-types';
import type { EventPayload } from '@almadar/core';
import { createLogger } from '@almadar/logger';

const log = createLogger('almadar:eventbus');
const subLog = createLogger('almadar:eventbus:subscribe');
const scopeLog = createLogger('almadar:ui:trait-scope');

// Re-export types for convenience
export type { BusEvent, BusEventSource, BusEventListener, Unsubscribe, EventBusContextType };
/** @deprecated Use BusEventListener from @almadar/core. */
export type { BusEventListener as EventListener };

// ============================================================================
// Global Event Bus Bridge (Window-Level for Cross-Package Communication)
// ============================================================================

// Extend Window interface for TypeScript
declare global {
  interface Window {
    __kflowEventBus?: EventBusContextType | null;
  }
}

/**
 * Global event bus reference for bridging between packages.
 *
 * Uses window-level global to enable cross-package communication.
 * This allows @almadar/ui components to emit events to the same bus
 * that the consuming app's trait state machine listens to.
 *
 * When the EventBusProvider mounts, it sets window.__kflowEventBus.
 * Components in any package can then use this shared event bus.
 *
 * SSR Safety: All window access is guarded by `typeof window !== 'undefined'`.
 * React Compiler Safety: The global bus reference is set once at provider mount
 * and is stable — no render-path side effects. In practice, the React context
 * path (priority 1) is used in real apps; the window global (priority 2) is
 * only reached when no EventBusProvider is in the tree (e.g., Storybook).
 */

/**
 * Set the global event bus reference.
 * Called by EventBusProvider when it mounts.
 *
 * @param bus - The event bus context to set as global, or null to clear
 */
export function setGlobalEventBus(bus: EventBusContextType | null): void {
  if (typeof window !== 'undefined') {
    window.__kflowEventBus = bus;
  }
}

/**
 * Get the global event bus reference.
 *
 * @returns The global event bus if set, null otherwise
 */
export function getGlobalEventBus(): EventBusContextType | null {
  if (typeof window !== 'undefined') {
    return window.__kflowEventBus ?? null;
  }
  return null;
}

// ============================================================================
// Fallback Event Bus (for use outside EventBusProvider)
// ============================================================================

const fallbackListeners = new Map<string, Set<BusEventListener>>();
const fallbackAnyListeners = new Set<BusEventListener>();

const fallbackEventBus: EventBusContextType = {
  emit: (type: string, payload?: EventPayload, source?: BusEventSource) => {
    const event: BusEvent = {
      type,
      payload,
      timestamp: Date.now(),
      source,
    };
    const handlers = fallbackListeners.get(type);
    log.debug('emit', { type, payloadKeys: payload ? Object.keys(payload).length : 0, listenerCount: (handlers?.size ?? 0) + fallbackAnyListeners.size });
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          log.error('Error in listener', { type, error: error instanceof Error ? error : String(error) });
        }
      });
    }
    // Notify wildcard listeners
    fallbackAnyListeners.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        log.error('Error in onAny listener', { type, error: error instanceof Error ? error : String(error) });
      }
    });
  },
  on: (type: string, listener: BusEventListener): Unsubscribe => {
    if (!fallbackListeners.has(type)) {
      fallbackListeners.set(type, new Set());
    }
    fallbackListeners.get(type)!.add(listener);
    subLog.debug('subscribe', { type, totalListeners: fallbackListeners.get(type)!.size });
    return () => {
      const handlers = fallbackListeners.get(type);
      if (handlers) {
        handlers.delete(listener);
        if (handlers.size === 0) {
          fallbackListeners.delete(type);
        }
      }
    };
  },
  once: (type: string, listener: BusEventListener): Unsubscribe => {
    const wrappedListener: BusEventListener = (event) => {
      fallbackListeners.get(type)?.delete(wrappedListener);
      listener(event);
    };
    return fallbackEventBus.on(type, wrappedListener);
  },
  hasListeners: (type: string): boolean => {
    const handlers = fallbackListeners.get(type);
    return handlers !== undefined && handlers.size > 0;
  },
  onAny: (listener: BusEventListener): Unsubscribe => {
    fallbackAnyListeners.add(listener);
    subLog.debug('subscribe:any', { totalAnyListeners: fallbackAnyListeners.size });
    return () => { fallbackAnyListeners.delete(listener); };
  },
};

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Hook for accessing the event bus.
 *
 * Uses EventBusProvider context if available, otherwise falls back to
 * a simple in-memory event bus (for design system / Storybook).
 *
 * @returns Event bus instance with emit, on, once, and hasListeners methods
 *
 * @example
 * ```tsx
 * const eventBus = useEventBus();
 *
 * // Emit an event
 * eventBus.emit('UI:CLICK', { id: '123' });
 *
 * // Subscribe to an event
 * useEffect(() => {
 *   return eventBus.on('UI:CLICK', (event) => {
 *     console.log('Clicked:', event.payload);
 *   });
 * }, []);
 * ```
 */
export function useEventBus(): EventBusContextType {
  const baseBus = useRootEventBus();

  // Trait-scope qualification (Phase 4 producer-side fix).
  //
  // Pre-fix, pure components like `<Button action="X" />` emitted bare
  // `UI:X` keys via this hook. Subscribers (`useTraitStateMachine`) had
  // moved to the qualified `UI:Orbital.Trait.X` form, so the click went
  // to four unrelated bare-key listeners and never reached the trait's
  // state machine. The runtime-path modal-not-mounting symptom traced
  // back to exactly this gap (`/tmp/rv-bus-trace.log`:
  // `[gap4-button-emit] UI:CREATE` → `[gap4-bus-emit] listenerCount=4`,
  // none of them the trait subscriber).
  //
  // Fix: when the calling component lives under a `TraitScopeProvider`
  // (mounted by `UISlotRenderer` at the slot-content boundary in
  // runtime mode, and by codegen at each trait view's root in compiled
  // mode), this hook returns a thin wrapper that prepends the scope to
  // every bare `UI:X` emit before delegating. Subscribe / on-any /
  // hasListeners / etc. pass through unchanged so the receiver side is
  // untouched. Already-qualified keys (`UI:Orbital.Trait.X`,
  // `SERVER:X`, `BRIDGE:X`, anything without a leading `UI:` and no
  // dots) flow through verbatim.
  // Trait-scope qualification + embedded-trait emit bubbling.
  //
  // (1) Bare `UI:X` emits from pure components (Button, Form, …) are
  // rewritten to the qualified `UI:Orbital.Trait.X` form that
  // `useTraitStateMachine` listens on.
  //
  // (2) R-EMBEDDED-EMIT-BUBBLE: when a trait is embedded inside a host's
  // render-ui (`@trait.X` / inline `<External.Trait …/>`), the providers
  // nest and `useTraitScopeChain` returns the full ancestor chain
  // (innermost-first). Every `UI:*` emit is fanned out to EACH scope on
  // the chain, so the embedded trait's emit also lands on the host's
  // qualified key — a `<UiButton.traits.ButtonRender action={CREATE}/>`
  // inside `HostManage` dispatches `UI:Orb.HostManage.CREATE`, which the
  // host subscribes to. The embedded trait's own key is still emitted, so
  // its own listeners keep firing. Additive fan-out, not a source rewrite.
  const chain = useTraitScopeChain();

  return useMemo(() => {
    if (chain.length === 0) {
      return {
        ...baseBus,
        emit: (type: string, payload?: EventPayload, source?: BusEventSource) => {
          // A machine-originated emit (EffectExecutor/server handlers stamp
          // `source.trait`) is bare BY DESIGN — the manager's bare-cascade and
          // the bridge relay deliver it. Only a sourceless bare emit is the
          // real defect this warn exists for: a component (Button/Form) firing
          // outside any TraitScopeProvider, whose click reaches no machine.
          if (typeof type === 'string' && type.startsWith('UI:') && !type.slice(3).includes('.') && !source?.trait) {
            scopeLog.warn('emit:bare-key-no-scope', { type });
          }
          baseBus.emit(type, payload, source);
        },
      };
    }
    return {
      ...baseBus,
      emit: (type: string, payload?: EventPayload, source?: BusEventSource) => {
        if (typeof type === 'string' && type.startsWith('UI:')) {
          const tail = type.slice(3);
          const isQualified = tail.includes('.');
          // Bare event name. For a qualified key the event is the segment
          // after `Orbital.Trait`; for a bare key the whole tail is the
          // event name.
          const event = isQualified ? tail.split('.').slice(2).join('.') : tail;
          if (!event) {
            baseBus.emit(type, payload, source);
            return;
          }
          // Fan out: one qualified key per scope on the chain
          // (innermost-first), deduped. Preserve the original qualified
          // key verbatim so subscribers keyed exactly to the emitter's own
          // scoped key (incl. the codegen-baked action string) still match.
          const keys = new Set<string>();
          if (isQualified) keys.add(type);
          for (const sc of chain) {
            keys.add(`UI:${sc.orbital}.${sc.trait}.${event}`);
          }
          if (keys.size > 1) {
            scopeLog.info('emit:fan-out', {
              from: type,
              keys: Array.from(keys),
              chainDepth: chain.length,
            });
          }
          // One physical emit: every key carries the same `source` object, the
          // identity ingress uses to deliver it to a host trait at most once.
          const physical = keys.size > 1 ? (source ?? {}) : source;
          for (const key of keys) baseBus.emit(key, payload, physical);
          return;
        }
        baseBus.emit(type, payload, source);
      },
    };
  }, [baseBus, chain]);
}

/**
 * The bus with no trait-scope rewriting: a machine-originated relay (an embedded
 * program's emit) goes out on exactly the keys it names.
 */
export function useRootEventBus(): EventBusContextType {
  const context = useContext(EventBusContext);
  // Priority: 1) React context, 2) Window global bridge, 3) Fallback
  // SSR-safe: getGlobalEventBus() guards with typeof window !== 'undefined'
  // React Compiler-safe: all three references are stable (no render side effects)
  return context ?? getGlobalEventBus() ?? fallbackEventBus;
}

// ============================================================================
// Convenience Hooks
// ============================================================================

/**
 * Hook for subscribing to a specific event.
 * Automatically cleans up subscription on unmount.
 *
 * @param event - Event name to subscribe to
 * @param handler - Event handler function
 *
 * @example
 * ```tsx
 * useEventListener('UI:CLICK', (event) => {
 *   console.log('Clicked:', event.payload);
 * });
 * ```
 */
export function useEventListener(
  event: string,
  handler: BusEventListener
): void {
  const eventBus = useEventBus();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrappedHandler: BusEventListener = (evt) => {
      handlerRef.current(evt);
    };
    const unsub = eventBus.on(event, wrappedHandler);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [event, eventBus]);
}

/**
 * Alias for useEventListener for backward compatibility
 */
export const useEventSubscription = useEventListener;

/**
 * Hook for emitting events.
 * Returns a memoized emit function.
 *
 * @returns Function to emit events
 *
 * @example
 * ```tsx
 * const emit = useEmitEvent();
 *
 * const handleClick = () => {
 *   emit('UI:CLICK', { id: '123' });
 * };
 * ```
 */
export function useEmitEvent(): (type: string, payload?: EventPayload, source?: BusEventSource) => void {
  const eventBus = useEventBus();
  return useCallback(
    (type: string, payload?: EventPayload, source?: BusEventSource) => {
      eventBus.emit(type, payload, source);
    },
    [eventBus]
  );
}

export default useEventBus;
