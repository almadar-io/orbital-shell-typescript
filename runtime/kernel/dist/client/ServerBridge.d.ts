import { IEventBus } from '../runtime/types.js';
import { EventPayload, EmittedEvent } from '@almadar/core';
import '../service/default-call-service.js';
import '../service/service-provider.js';
import '../kernel/program-effects.js';
import '../runtime/effects/composition/compose-behaviors.js';
import '../runtime/effects/composition/event-wiring.js';
import '../runtime/effects/composition/layout-strategy.js';
import '../runtime/effects/composition/pipe.js';

/**
 * ServerBridge - Client-Server Trait Communication
 *
 * Bridges the client EventBus with the server OrbitalRuntime:
 * 1. Forwards specified events from client to server
 * 2. Receives events from server (via polling or WebSocket)
 * 3. Puts server events onto client EventBus
 *
 * This enables cross-orbital communication between client and server traits.
 *
 * @example
 * ```typescript
 * import { ServerBridge } from '@kflow-builder/shared/runtime';
 * import { useEventBus } from './hooks/useEventBus';
 *
 * // In your app initialization
 * const eventBus = useEventBus();
 * const bridge = new ServerBridge({
 *   eventBus,
 *   serverUrl: '/api/orbitals',
 *   // Events to forward from client to server
 *   forwardEvents: ['ORDER_PLACED', 'PAYMENT_COMPLETED'],
 * });
 *
 * bridge.connect();
 *
 * // Now when client emits ORDER_PLACED, server traits receive it
 * eventBus.emit('ORDER_PLACED', { orderId: '123' });
 * ```
 *
 * @packageDocumentation
 */

interface ServerBridgeConfig {
    /** Client EventBus to bridge */
    eventBus: IEventBus;
    /** Base URL for orbital server API */
    serverUrl: string;
    /** Events to forward from client to server */
    forwardEvents?: string[];
    /** Forward all events matching pattern (e.g., 'Order*', '*') */
    forwardPattern?: string;
    /** Target orbital for forwarded events (or 'broadcast' for all) */
    targetOrbital?: string;
    /** Enable WebSocket for real-time server events */
    useWebSocket?: boolean;
    /** Polling interval in ms (if not using WebSocket) */
    pollInterval?: number;
    /** Enable debug logging */
    debug?: boolean;
    /** Custom fetch function (for testing or custom auth) */
    fetch?: typeof fetch;
}
interface ServerBridgeState {
    connected: boolean;
    lastError?: string;
    eventsForwarded: number;
    eventsReceived: number;
}
/**
 * Bridges client EventBus with server OrbitalRuntime
 */
declare class ServerBridge {
    private config;
    private state;
    private unsubscribes;
    private pollTimer?;
    private ws?;
    private fetchFn;
    /** The one HTTP request/response leg — shared with `@almadar/ui`'s transport (P5, EventTransport.ts). */
    private transport;
    constructor(config: ServerBridgeConfig);
    /**
     * Connect the bridge - start forwarding events
     */
    connect(): void;
    /**
     * Disconnect the bridge
     */
    disconnect(): void;
    /**
     * Get current bridge state
     */
    getState(): ServerBridgeState;
    private setupEventForwarding;
    private forwardToServer;
    private sendEventToOrbital;
    private fetchOrbitals;
    private setupPolling;
    private setupWebSocket;
    /**
     * Send an event directly to a specific orbital (bypassing EventBus)
     */
    sendEvent(orbitalName: string, event: string, payload?: EventPayload): Promise<{
        success: boolean;
        states?: Record<string, string>;
        emittedEvents?: EmittedEvent[];
        error?: string;
    }>;
    /**
     * Get current state of an orbital's traits
     */
    getOrbitalState(orbitalName: string): Promise<{
        success: boolean;
        states?: Record<string, string>;
        error?: string;
    }>;
    private log;
}
/**
 * Create a ServerBridge instance
 */
declare function createServerBridge(config: ServerBridgeConfig): ServerBridge;

export { ServerBridge, type ServerBridgeConfig, type ServerBridgeState, createServerBridge };
