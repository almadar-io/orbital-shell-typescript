'use client';

/**
 * ServerBridge - Lightweight client-server bridge for OrbPreview.
 *
 * When OrbPreview is given a `serverUrl`, this provider:
 * 1. Registers the schema with the server on mount
 * 2. Forwards trait events to the server after local processing
 * 3. Applies server clientEffects (render-ui with entity data) to slots via event bus
 * 4. Propagates server-emitted events through the local EventBus
 * 5. Unregisters on unmount
 *
 * Entity data flows through EntityStore. The server response contains
 * both `data` (entity records) and `clientEffects` (render-ui patterns).
 * OrbPreview advances EntityStore from response data; SlotContentRenderer
 * subscribes via useEntityRef for reactive resolution.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { OrbitalSchema } from '@almadar/core';
import type { EventTransport, AccessTokenProvider } from '../index';
import { createHttpTransport as createRuntimeHttpTransport } from '@almadar/shell-runtime/client/EventTransport';

// `EventTransport` (plan P5, `docs/Almadar_Runtime_Stateless_Stateful_PLAN.md`
// §4.2) is the ONE owner of the HTTP request/response leg. This provider is
// a thin context around it — register/unregister lifecycle + `connected` +
// `carriesCircuitState` — not a second transport implementation and not a
// second event-evaluation composition. Sending an event, folding its
// response, and re-fanning cascade events are ALL `@almadar/ui`'s client
// role now (`hooks/circuit/useCircuitKernel.ts`'s kernel client):
// the old `sendEvent`/`reEmitServerEvent`/`tickRelay`/`commandPump` two-
// bus-hop apparatus is gone with them — `applyOrbitalEventResponse`'s
// in-process fold makes the rebroadcast-ordering problem this provider used
// to solve by deferral structurally impossible instead (no bus hop to order).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServerBridgeContextValue {
  connected: boolean;
  /**
   * From the transport's `register()` result
   * (`EventTransportRegisterResult.carriesCircuitState`, `@almadar/runtime`):
   * `true` = the stateless topology (a posted leg must carry
   * `traits`/`entityByTrait`), `false` = the server (or an in-process
   * evaluator) holds circuit state itself.
   */
  carriesCircuitState: boolean;
  /** `register()` has resolved, so `carriesCircuitState` is the transport's
   *  real topology rather than the pre-register guess. */
  topologyKnown: boolean;
  /** The ONE transport this bridge manages the register/unregister
   *  lifecycle for — `useCircuitKernel` dispatches through it directly. */
  transport: EventTransport;
}

/**
 * @deprecated Alias for `@almadar/runtime`'s `EventTransport` (plan P5) —
 * kept only because in-package consumers (`OrbPreview.tsx`,
 * `OrbitalPluginHost.tsx`) still import the name.
 * Import `EventTransport` directly in new code.
 */
export type ServerBridgeTransport = EventTransport;

// `AccessTokenProvider` is `@almadar/runtime`'s (imported above) — re-exported
// below for consumers that import it from this module.
export type { AccessTokenProvider };

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ServerBridgeContext = createContext<ServerBridgeContextValue | null>(null);

/**
 * Access the server bridge. Returns a no-op stub when outside the provider —
 * `useCircuitKernel` treats an absent/no-op transport as offline (plan G7).
 */
export function useServerBridge(): ServerBridgeContextValue {
  const ctx = useContext(ServerBridgeContext);
  if (!ctx) {
    return {
      connected: false,
      carriesCircuitState: false,
      topologyKnown: false,
      transport: {
        async register() { return { success: false, carriesCircuitState: false }; },
        async unregister() {},
        async send() { throw new Error('useServerBridge: no ServerBridgeProvider in the component tree'); },
      },
    };
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface ServerBridgeProviderProps {
  schema: OrbitalSchema;
  /** HTTP server URL (canonical playground-runtime / apps/builder-server). */
  serverUrl?: string;
  /**
   * Custom `EventTransport` (plan P5, `@almadar/runtime`). Use this for
   * in-process execution (e.g. an in-process test harness invokes
   * `OrbitalServerRuntime.processOrbitalEvent` directly via
   * `createInProcessTransport`). Mutually exclusive with `serverUrl`.
   */
  transport?: EventTransport;
  /**
   * Bearer token for the HTTP transport (`Authorization` on every fetch, and on the
   * request that mints the SSE stream's single-use ticket, since EventSource cannot set headers).
   * Ignored with a custom `transport`.
   */
  getAccessToken?: AccessTokenProvider;
  children: ReactNode;
}

export function ServerBridgeProvider({
  schema,
  serverUrl,
  transport: customTransport,
  getAccessToken,
  children,
}: ServerBridgeProviderProps) {
  if (!serverUrl && !customTransport) {
    throw new Error('ServerBridgeProvider requires either serverUrl or transport');
  }
  if (serverUrl && customTransport) {
    throw new Error('ServerBridgeProvider accepts serverUrl OR transport, not both');
  }

  const [connected, setConnected] = useState(false);
  const [carriesCircuitState, setCarriesCircuitState] = useState(false);
  const [topologyKnown, setTopologyKnown] = useState(false);

  // Resolve the transport: custom takes precedence (only one is set per the
  // mutual-exclusion check above). `@almadar/runtime`'s `createHttpTransport`
  // (plan P5) is the ONE owner of the HTTP leg — this provider builds an
  // instance of it rather than implementing a second one.
  const transport = useMemo<EventTransport>(
    () => customTransport ?? createRuntimeHttpTransport({ serverUrl: serverUrl!, getAccessToken }),
    [serverUrl, customTransport, getAccessToken],
  );

  const registerSchema = useCallback(
    async () => transport.register(schema),
    [schema, transport],
  );

  const unregisterSchema = useCallback(
    async () => transport.unregister(),
    [transport],
  );

  // Register on mount, unregister on unmount. `useCircuitKernel` dispatches
  // through `transport` directly (post/fold/push-ingress all live in the
  // client role now) — this effect owns only the register/unregister
  // lifecycle + the `connected`/`carriesCircuitState` facts.
  useEffect(() => {
    if (!schema) return;

    let cancelled = false;
    registerSchema().then((result) => {
      if (cancelled) return;
      setConnected(result.success);
      setCarriesCircuitState(result.carriesCircuitState);
      setTopologyKnown(true);
    });

    return () => {
      cancelled = true;
      setConnected(false);
      setTopologyKnown(false);
      unregisterSchema();
    };
  }, [schema, registerSchema, unregisterSchema]);

  return (
    <ServerBridgeContext.Provider value={{ connected, carriesCircuitState, topologyKnown, transport }}>
      {children}
    </ServerBridgeContext.Provider>
  );
}
