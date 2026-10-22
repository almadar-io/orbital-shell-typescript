import { readFileSync } from 'node:fs';
import type { JsonValue } from '@almadar/core';
import { createNodeOsHost } from '../src/os-node.js';
import { describe, expect, it, vi } from 'vitest';
import { createHttpPorts, CredentialStore, getEffectiveCredentialStore, runWithCredentialScope, type CredentialPersistence } from '@almadar/shell-runtime';
import { installNodeHostPorts, nodeNetPort, pinnedFetchNode, resolveHostNode } from '../src/index.js';

const agentOptions = vi.hoisted(() => ({ seen: [] as Array<{ headersTimeout?: number; bodyTimeout?: number }> }));
vi.mock('undici', () => ({
  Agent: class {
    constructor(options: { headersTimeout?: number; bodyTimeout?: number }) { agentOptions.seen.push(options); }
    close(): Promise<void> { return Promise.resolve(); }
  },
  fetch: async () => new Response('ok'),
}));

describe('pinned transport timers', () => {
  const send = async (signal: AbortSignal | undefined): Promise<{ headersTimeout?: number; bodyTimeout?: number }> => {
    agentOptions.seen.length = 0;
    await pinnedFetchNode(new URL('http://127.0.0.1:9/x'), { method: 'GET', headers: [], redirect: 'manual', ...(signal !== undefined ? { signal } : {}) }, '127.0.0.1');
    return agentOptions.seen[0];
  };

  it('a request with a deadline carries it in the signal alone: undici keeps no 300s timer of its own', async () => {
    const options = await send(AbortSignal.timeout(900_000));
    expect(options.headersTimeout).toBe(0);
    expect(options.bodyTimeout).toBe(0);
  });

  it('control: a request with no deadline keeps undici\'s default timers', async () => {
    const options = await send(undefined);
    expect(options.headersTimeout).toBeUndefined();
    expect(options.bodyTimeout).toBeUndefined();
  });
});

describe('node host ports', () => {
  const kernel = async (): Promise<never> => { throw new Error('unused'); };
  const persistence: CredentialPersistence = { create: async () => ({ id: 'x' }), update: async () => undefined, delete: async () => undefined, list: async () => [] };

  it('without installed ports the server http ports refuse to default their fetch', () => {
    expect(() => createHttpPorts({ kernel, egress: [] })).toThrow(/NetPort/);
  });

  it('without installed ports a tenant scope is refused', () => {
    expect(() => runWithCredentialScope(new CredentialStore(persistence), () => 1)).toThrow(/CredentialScopeStorage/);
  });

  it('a literal address resolves to itself; a name goes through dns', async () => {
    expect(await resolveHostNode('127.0.0.1')).toEqual({ literal: true, addresses: ['127.0.0.1'] });
    expect(await resolveHostNode('::1')).toEqual({ literal: true, addresses: ['::1'] });
    const named = await resolveHostNode('localhost');
    expect(named.literal).toBe(false);
    expect(named.addresses.length).toBeGreaterThan(0);
  });

  it('installed, the http ports default to the node net port and tenant scopes carry across awaits', async () => {
    installNodeHostPorts();
    const ports = createHttpPorts({ kernel, egress: [] });
    expect(ports.fetch).toBe(nodeNetPort.fetch);
    expect(ports.resolve).toBe(nodeNetPort.resolve);
    const store = new CredentialStore(persistence);
    const seen = await runWithCredentialScope(store, async () => {
      await Promise.resolve();
      return getEffectiveCredentialStore();
    });
    expect(seen).toBe(store);
    expect(getEffectiveCredentialStore()).toBeNull();
  });
});


describe('raw Node network asks', () => {
  it('refuses tcp-listen without stream context using the shared canonical host fixture', async () => {
    const fixture: { steps: Array<{ op?: string; key?: string; args?: JsonValue[]; expect?: JsonValue }> } = JSON.parse(readFileSync(new URL('./fixtures/os-asks.json', import.meta.url), 'utf8'));
    const step = fixture.steps.find((entry) => entry.op === 'os/tcp-listen' && entry.key === undefined);
    if (step?.args === undefined || step.expect === undefined) throw new Error('missing unkeyed listener fixture');
    const host = createNodeOsHost({ allows: () => false, globMatches: () => false, isPublicAddress: () => false });
    try {
      expect(await host.answer('os/tcp-listen', step.args)).toEqual(step.expect);
      expect(await host.answer('os/tcp-connect', ['127.0.0.1', 1])).toMatchObject({ error: { kind: 'denied' } });
      expect(await host.answer('os/watch-port', [])).toMatchObject({ error: { kind: 'unsupported' } });
    } finally { host.close(); }
  });
});
