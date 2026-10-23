import { IEventBus, RuntimeEvent, EventListener, Unsubscribe } from '../runtime/types.js';
import { EventPayload } from '@almadar/core';
import '../service/default-call-service.js';
import '../service/service-provider.js';
import '../kernel/program-effects.js';
import '../runtime/effects/composition/compose-behaviors.js';
import '../runtime/effects/composition/event-wiring.js';
import '../runtime/effects/composition/layout-strategy.js';
import '../runtime/effects/composition/pipe.js';

/**
 * EventBus - Platform-Agnostic Pub/Sub Implementation
 *
 * Pure TypeScript event bus for cross-trait communication.
 * Works on both client (browser) and server (Node.js).
 *
 * @packageDocumentation
 */

/**
 * EventBus - Simple pub/sub event bus
 *
 * @example
 * ```typescript
 * const bus = new EventBus({ debug: true });
 *
 * // Subscribe
 * const unsub = bus.on('ORDER_CONFIRMED', (event) => {
 *   log.debug('order-confirmed', { orderId: event.payload?.orderId });
 * });
 *
 * // Emit
 * bus.emit('ORDER_CONFIRMED', { orderId: '123' });
 *
 * // Unsubscribe
 * unsub();
 * ```
 */
declare class EventBus implements IEventBus {
    private listeners;
    /** Maximum recursion depth before circuit breaker activates (RCG-05) */
    private maxDepth;
    /** Current emission depth for circular loop detection */
    private depth;
    constructor(options?: {
        debug?: boolean;
        maxDepth?: number;
    });
    /**
     * Emit an event to all registered listeners.
     *
     * Includes circuit breaker (RCG-05): if emit is called recursively
     * beyond `maxDepth`, the event is dropped and an error is logged.
     * This prevents infinite loops from circular emit/listen chains.
     */
    emit(type: string, payload?: EventPayload, source?: RuntimeEvent['source'], routingKey?: string): void;
    /**
     * Subscribe to an event type
     */
    on(type: string, listener: EventListener): Unsubscribe;
    /**
     * Subscribe to ALL events (wildcard listener)
     * Useful for event tracking, logging, debugging
     */
    onAny(listener: EventListener): Unsubscribe;
    /**
     * Check if there are listeners for an event type
     */
    hasListeners(type: string): boolean;
    /**
     * Get all registered event types
     */
    getRegisteredEvents(): string[];
    /**
     * Clear all listeners
     */
    clear(): void;
    /**
     * Get listener count for an event type (for testing)
     */
    getListenerCount(type: string): number;
}
/**
 * Create a new EventBus instance
 */
declare function createEventBus(options?: {
    debug?: boolean;
}): IEventBus;

export { EventBus, createEventBus };
