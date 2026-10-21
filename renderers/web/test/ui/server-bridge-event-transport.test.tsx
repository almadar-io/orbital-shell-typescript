/**
 * `ServerBridgeProvider` as a context around `@almadar/runtime`'s
 * `EventTransport` port (plan P5, W5b,
 * `docs/Almadar_Runtime_Stateless_Stateful_PLAN.md` §4.2/§4.3). The provider
 * owns ONLY register/unregister lifecycle + `connected`/`carriesCircuitState`
 * now — sending an event, folding its response and re-fanning server-pushed
 * cascade events are `hooks/circuit/useCircuitKernel.ts`'s job (it dispatches
 * through `bridge.transport` directly), so this suite no longer drives
 * `sendEvent`/`stateSource`/a bus re-emit through the provider — see
 * `circuit-kernel-fanout.test.ts` and `useCircuitKernel`'s own push-ingress
 * effect for those.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { ServerBridgeProvider, useServerBridge, type ServerBridgeContextValue } from '../../src/providers/ServerBridge';
import { createInProcessTransport, type EventTransport, type OrbitalEvaluator } from '../../src';
import type { OrbitalSchema } from '@almadar/core';

const SCHEMA: OrbitalSchema = { name: 'in-process-probe', orbitals: [] };

let bridgeRef: ServerBridgeContextValue | null = null;

function Probe(): null {
  bridgeRef = useServerBridge();
  return null;
}

function mount(transport: EventTransport): void {
  render(
    <EventBusProvider>
      <ServerBridgeProvider schema={SCHEMA} transport={transport}>
        <Probe />
      </ServerBridgeProvider>
    </EventBusProvider>,
  );
}

beforeEach(() => {
  bridgeRef = null;
});

describe('ServerBridgeProvider — register/unregister lifecycle around an injected EventTransport', () => {
  it('register success + carriesCircuitState default (false) reach the context', async () => {
    const evaluate: OrbitalEvaluator = async () => ({ success: true, transitioned: false, states: {}, emittedEvents: [] });
    const transport = createInProcessTransport(evaluate);
    mount(transport);

    await waitFor(() => expect(bridgeRef?.connected).toBe(true));
    expect(bridgeRef?.carriesCircuitState).toBe(false);
    expect(bridgeRef?.transport).toBe(transport);
  });

  it('carriesCircuitState: true (the stateless topology) reaches the context', async () => {
    const evaluate: OrbitalEvaluator = async () => ({ success: true, transitioned: false, states: {}, emittedEvents: [] });
    mount(createInProcessTransport(evaluate, { carriesCircuitState: true }));

    await waitFor(() => expect(bridgeRef?.connected).toBe(true));
    expect(bridgeRef?.carriesCircuitState).toBe(true);
  });

  it('a register failure leaves connected false', async () => {
    const transport: EventTransport = {
      async register() { return { success: false, carriesCircuitState: false }; },
      async unregister() {},
      async send() { throw new Error('not reached'); },
    };
    mount(transport);

    await waitFor(() => expect(bridgeRef).not.toBeNull());
    expect(bridgeRef?.connected).toBe(false);
  });

  it('useServerBridge outside a provider returns a disconnected, non-throwing stub', () => {
    render(<Probe />);
    expect(bridgeRef?.connected).toBe(false);
    expect(bridgeRef?.carriesCircuitState).toBe(false);
  });
});
