// The kernel's credential store connects and refreshes through the host's token POST: the built kernel builds the request
// and settles the reply, the host only sends. These run the real wasm vault with a scripted POST.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as wasm from '@almadar/kernel';
import type { EntityRow } from '@almadar/core';
import {
  answerRequest,
  CredentialVault,
  createSecretPorts,
  createSecretStore,
  InFlightCalls,
  type CredentialRowsPort,
  type KernelHostPorts,
  type TokenEndpointPost,
  type TokenRequest,
} from '@almadar/shell-runtime';

wasm.initSync({ module: readFileSync(createRequire(import.meta.url).resolve('@almadar/kernel/kernel.wasm')) });

const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const GRANT = {
  name: 'DRIVE', principal: 'u1', tokenEndpoint: 'https://auth.example/token', grant: 'authorization_code', code: 'one-time-CODE',
  redirectUri: 'https://app.example/cb', clientId: 'CLIENT_ID', clientAuth: 'body' as const, scopes: [],
};
const FRESH = '{"access_token":"ACCESS-1","token_type":"Bearer","refresh_token":"REFRESH-1","expires_in":3600}';
const DUE = '{"access_token":"ACCESS-OLD","token_type":"Bearer","refresh_token":"REFRESH-OLD","expires_in":0}';
const ROTATED = '{"access_token":"ACCESS-2","token_type":"Bearer","refresh_token":"REFRESH-2","expires_in":3600}';

class MemoryRows implements CredentialRowsPort {
  rows: EntityRow[] = [];
  async list() { return this.rows.map((row) => ({ ...row })); }
  async create(row: EntityRow & { id: string }) { this.rows.push({ ...row }); }
  async update(id: string, data: EntityRow) { Object.assign(this.rows.find((row) => row.id === id) ?? {}, data); }
  async delete(id: string) { const before = this.rows.length; this.rows = this.rows.filter((row) => row.id !== id); return this.rows.length < before; }
}

async function vault() {
  const store = await CredentialVault.open(new wasm.CredentialVault(KEY), new MemoryRows());
  await store.set('google', 'CLIENT_ID', 'client-id-1');
  return store;
}

function scripted(replies: Array<{ status: number; body: string } | Error>) {
  const seen: TokenRequest[] = [];
  const post: TokenEndpointPost = async (request) => {
    seen.push(request);
    const next = replies.shift();
    if (next === undefined) throw new Error('unscripted token POST');
    if (next instanceof Error) throw next;
    return next;
  };
  return { post, seen };
}

function ports(connect: ReturnType<typeof createSecretPorts>['connect']): KernelHostPorts {
  return {
    persistence: { create: async () => { throw new Error('x'); }, update: async () => { throw new Error('x'); }, delete: async () => { throw new Error('x'); }, getById: async () => { throw new Error('x'); }, list: async () => { throw new Error('x'); } },
    callService: async () => null,
    programEffect: () => undefined,
    inFlightCalls: new InFlightCalls(),
    servicePorts: () => { throw new Error('x'); },
    deliverLive: () => undefined,
    deferCallOutcome: () => undefined,
    secretPorts: { random: () => new Uint8Array(0), secrets: createSecretStore(), ...(connect !== undefined ? { connect } : {}) },
  };
}

describe('credentialConnect on the node host', () => {
  it('connects through the token POST, keeps the row, and never lets the code or a token into the answer', async () => {
    const store = await vault();
    const { post, seen } = scripted([{ status: 200, body: FRESH }]);
    const answer = await answerRequest(ports((grant) => store.connect(grant, post)), { kind: 'credentialConnect', grant: GRANT }, { orbital: 'Main' });
    expect(answer).toEqual({ kind: 'credentialConnect', result: { ok: { connected: true } } });
    expect(seen[0]?.endpoint).toBe('https://auth.example/token');
    expect(store.resolve('DRIVE', 'u1')).toBe('ACCESS-1');
    expect(JSON.stringify(answer)).not.toMatch(/ACCESS|REFRESH|one-time/);
  });

  it('answers the kernel failure kinds: a provider refusal, a transport failure, and a host with no connect port', async () => {
    const store = await vault();
    const refused = await store.connect(GRANT, scripted([{ status: 400, body: '{"error":"invalid_grant"}' }]).post);
    expect(refused).toMatchObject({ error: { kind: 'invalid_grant' } });
    const down = await store.connect(GRANT, scripted([new Error('could not reach the token endpoint (ECONNREFUSED)')]).post);
    expect(down).toMatchObject({ error: { kind: 'transport' } });
    expect(store.resolve('DRIVE', 'u1')).toBeUndefined();
    const bare = await answerRequest(ports(undefined), { kind: 'credentialConnect', grant: GRANT }, { orbital: 'Main' });
    expect(bare).toMatchObject({ result: { error: { kind: 'unavailable' } } });
  });
});

describe('refresh on resolve on the node host', () => {
  async function due() {
    const store = await vault();
    await store.connect(GRANT, scripted([{ status: 200, body: DUE }]).post);
    return store;
  }
  const hostOf = (store: CredentialVault) => ({ store: async () => store, resolve: async (name: string, principal: string | undefined) => store.resolve(name, principal) });

  it('refreshes a due credential once for concurrent resolves and persists the rotated tokens', async () => {
    const store = await due();
    const { post, seen } = scripted([{ status: 200, body: ROTATED }]);
    const secrets = createSecretStore(Date.now, hostOf(store), post);
    const [a, b] = await Promise.all([secrets.get('DRIVE', 'u1'), secrets.get('DRIVE', 'u1')]);
    expect([a, b]).toEqual(['ACCESS-2', 'ACCESS-2']);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.body).toContain('refresh_token=REFRESH-OLD');
    expect(await secrets.get('DRIVE', 'u1')).toBe('ACCESS-2');
    expect(seen).toHaveLength(1);
  });

  it('drops the row on invalid_grant and keeps it on a transport failure', async () => {
    const store = await due();
    const down = createSecretStore(Date.now, hostOf(store), scripted([new Error('timed out')]).post);
    await expect(down.get('DRIVE', 'u1')).rejects.toMatchObject({ kind: 'transport' });
    expect(store.resolve('DRIVE', 'u1')).toBe('ACCESS-OLD');
    const refused = createSecretStore(Date.now, hostOf(store), scripted([{ status: 400, body: '{"error":"invalid_grant"}' }]).post);
    expect(await refused.get('DRIVE', 'u1')).toBeUndefined();
    expect(store.resolve('DRIVE', 'u1')).toBeUndefined();
  });

  it('control: a host with no token POST resolves as before and never attempts a refresh', async () => {
    const store = await due();
    expect(await createSecretStore(Date.now, hostOf(store)).get('DRIVE', 'u1')).toBe('ACCESS-OLD');
  });
});
