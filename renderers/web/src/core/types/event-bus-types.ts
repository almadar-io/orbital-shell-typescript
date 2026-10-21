/**
 * Event Bus Types
 *
 * Re-exports from @almadar/core so every package agrees on the same
 * bus event envelope. @almadar/ui no longer owns its own KFlowEvent —
 * that type was folded into core's BusEvent.
 *
 * @packageDocumentation
 */

import type {
  BusEvent,
  BusEventSource,
  BusEventListener,
  EventPayload,
  Unsubscribe,
} from "@almadar/core";

export type { BusEvent, BusEventSource, BusEventListener, EventPayload, Unsubscribe };
/** @deprecated Use BusEventListener from @almadar/core directly. */
export type EventListener = BusEventListener;

/**
 * Event bus context type.
 *
 * `emit` accepts `EventPayload` from `@almadar/core` — the canonical
 * object shape (index signature over `EventPayloadValue`) that the bus
 * envelope stores and listeners consume. Pattern-specific payload types
 * from `@almadar/core/patterns` (`ItemActionPayload`, `SelectionChangePayload`,
 * `FormSubmitPayload`, ...) are structural subtypes of `EventPayload`,
 * so components can pass them in without casts.
 */
export interface EventBusContextType {
  /**
   * Emit an event to all listeners.
   *
   * @param type - Event type identifier
   * @param payload - Optional payload data (shape matches {@link EventPayload})
   * @param source - Optional origin info (orbital/trait/...)
   */
  emit: (type: string, payload?: EventPayload, source?: BusEventSource) => void;

  /**
   * Subscribe to an event type.
   *
   * @param type - Event type to listen for
   * @param listener - Callback function
   * @returns Unsubscribe function
   */
  on: (type: string, listener: BusEventListener) => Unsubscribe;

  /**
   * Subscribe to an event type, but only fire once.
   *
   * @param type - Event type to listen for
   * @param listener - Callback function
   * @returns Unsubscribe function
   */
  once: (type: string, listener: BusEventListener) => Unsubscribe;

  /**
   * Check if there are any listeners for an event type.
   *
   * @param type - Event type to check
   * @returns True if there are listeners
   */
  hasListeners: (type: string) => boolean;

  /**
   * Subscribe to ALL events regardless of type.
   * Useful for verification, debugging, and analytics.
   *
   * @param listener - Callback function invoked for every emitted event
   * @returns Unsubscribe function
   */
  onAny?: (listener: BusEventListener) => Unsubscribe;
}
