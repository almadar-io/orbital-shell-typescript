/**
 * The HTTP server bridge authenticates with the hosting server: every fetch
 * carries `Authorization: Bearer <token>`, and the SSE channel opens with a
 * single-use ticket minted with that bearer (EventSource cannot set headers and
 * a token in the URL leaks into logs). Without a provider nothing is attached
 * (dev servers bypass auth).
 *
 * The SSE `subscribe()` call lives in `useTraitStateMachine`'s push ingress
 * (the provider only owns register/unregister + exposing `transport`), so this
 * suite drives a minimal `useTraitStateMachine` consumer alongside the
 * provider, the same pairing `OrbPreview`'s `TraitInitializer` uses.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { ServerBridgeProvider, useServerBridge } from '../../src/providers/ServerBridge';
import { useTraitStateMachine } from '../../src/hooks/useTraitStateMachine';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import type { OrbitalSchema } from '@almadar/core';

const schema: OrbitalSchema = { name: 'Probe', orbitals: [] };

class FakeEventSource {
  static urls: string[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    FakeEventSource.urls.push(url);
  }
  close(): void {}
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
  new Response(JSON.stringify({ success: true, ticket: 'tkt-ui' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
);

beforeEach(() => {
  FakeEventSource.urls = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

function headerOf(call: [RequestInfo | URL, RequestInit?], name: string): string | null {
  return new Headers(call[1]?.headers).get(name);
}

const NO_TRAITS: never[] = [];

const SLOTS: UISlotManager = {
  slots: {},
  render: () => 'id',
  clear: () => undefined,
  clearBySource: () => undefined,
  clearById: () => undefined,
  clearAll: () => undefined,
  subscribe: () => () => undefined,
  hasContent: () => false,
  getContent: () => null,
  getTraitContent: () => null,
  subscribeTrait: () => () => undefined,
  updateTraitContent: () => 'id',
};

/** Mounts the trait state machine off the bridge's transport — its push
 *  ingress is what actually triggers the SSE `subscribe()` call. Module-scoped
 *  bindings and slots keep the kernel (and the subscription) reference-stable
 *  across renders, as `OrbPreview`'s memoized caller does. */
function KernelConsumer(): null {
  const bridge = useServerBridge();
  useTraitStateMachine(NO_TRAITS, SLOTS, { orbitals: schema.orbitals, ...(bridge.transport !== undefined ? { transport: bridge.transport } : {}), carriesCircuitState: bridge.carriesCircuitState });
  return null;
}

describe('ServerBridgeProvider auth', () => {
  it('sends the bearer token on register and mints the SSE ticket with it', async () => {
    const getAccessToken = vi.fn(async () => 'id-token-1');
    render(
      <EventBusProvider>
        <ServerBridgeProvider schema={schema} serverUrl="https://api.test/api/orbitals" getAccessToken={getAccessToken}>
          <KernelConsumer />
        </ServerBridgeProvider>
      </EventBusProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const register = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/register'));
    expect(register).toBeDefined();
    expect(headerOf(register!, 'Authorization')).toBe('Bearer id-token-1');
    await waitFor(() => expect(FakeEventSource.urls).toHaveLength(1));
    const url = new URL(FakeEventSource.urls[0]);
    expect(url.pathname).toBe('/api/events');
    expect(url.searchParams.get('ticket')).toBe('tkt-ui');
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(url.searchParams.get('clientId')).toBeTruthy();
    const mint = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/events/ticket'));
    expect(mint).toBeDefined();
    expect(headerOf(mint!, 'Authorization')).toBe('Bearer id-token-1');
  });

  it('attaches nothing without a token provider', async () => {
    render(
      <EventBusProvider>
        <ServerBridgeProvider schema={schema} serverUrl="https://api.test/api/orbitals">
          <KernelConsumer />
        </ServerBridgeProvider>
      </EventBusProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const register = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/register'));
    expect(headerOf(register!, 'Authorization')).toBeNull();
    await waitFor(() => expect(FakeEventSource.urls).toHaveLength(1));
    const url = new URL(FakeEventSource.urls[0]);
    expect(url.searchParams.get('ticket')).toBe('tkt-ui');
    expect(url.searchParams.has('access_token')).toBe(false);
    const mint = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/events/ticket'));
    expect(headerOf(mint!, 'Authorization')).toBeNull();
  });
});
