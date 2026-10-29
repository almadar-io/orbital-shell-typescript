// The credential-holding secret ports of a browser-extension host: the profile's credential vault (the kernel's encrypted store) answers every
// secret ask, the build's provisioned credentials back it up for the app-wide slot only, a Google connection keeps the
// host's Firebase credential with its account label, and a program is only ever told whether a credential is held and as whom.
import { describe, expect, it } from 'vitest';
import { CredentialVault, credentialForgetPayload, credentialStatusPayload, type CredentialRowsPort } from '@almadar/shell-web';
import type { EntityRow } from '@almadar/core';
import { createExtensionSecretPorts } from '../src/kernel/extension-ports.js';
import { kernel } from './helpers/kernel.js';

const MASTER_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

class Rows implements CredentialRowsPort {
  readonly rows: EntityRow[] = [];
  async list(): Promise<EntityRow[]> {
    return [...this.rows];
  }
  async create(row: EntityRow & { id: string }): Promise<void> {
    this.rows.push(row);
  }
  async update(id: string, data: EntityRow): Promise<void> {
    const at = this.rows.findIndex((row) => row.id === id);
    if (at >= 0) this.rows[at] = { ...this.rows[at], ...data, id };
  }
  async delete(id: string): Promise<void> {
    const at = this.rows.findIndex((row) => row.id === id);
    if (at >= 0) this.rows.splice(at, 1);
  }
}

async function ports(options: Partial<Parameters<typeof createExtensionSecretPorts>[0]> = {}) {
  const rows = new Rows();
  const store = await CredentialVault.open(new kernel.CredentialVault(MASTER_KEY), rows);
  const secretPorts = createExtensionSecretPorts({ credentials: Promise.resolve(store), ...options });
  return { secretPorts, store, rows };
}

describe('extension secret ports', () => {
  it('answers a secret from the profile store, then from the build\'s provisioned credentials for the app-wide slot only', async () => {
    const { secretPorts, store } = await ports({ provisioned: { KNOWLEDGE_GOOGLE_CLIENT_ID: 'client-id-from-build', STORED: 'build-value' } });
    await store.set('kernel', 'STORED', 'profile-value');
    expect(await secretPorts.secrets.get('KNOWLEDGE_GOOGLE_CLIENT_ID')).toBe('client-id-from-build');
    expect(await secretPorts.secrets.get('STORED')).toBe('profile-value');
    expect(await secretPorts.secrets.get('KNOWLEDGE_GOOGLE_CLIENT_ID', 'someone')).toBeUndefined();
    expect(await secretPorts.secrets.get('MISSING')).toBeUndefined();
  });

  it('a consent ask runs the host\'s sign-in, keeps its credential with the label, and answers no code: the program learns connected and as whom, never the token', async () => {
    const { secretPorts, rows } = await ports({ signIn: async () => ({ name: 'KNOWLEDGE_REFRESH_TOKEN', value: 'FIREBASE-RT', label: 'ada@example.com' }) });
    expect(await credentialStatusPayload(secretPorts, { credential: 'KNOWLEDGE_REFRESH_TOKEN', scope: 'app' }, undefined)).toEqual({ connected: false, label: '' });
    const answered = await secretPorts.oauth?.answer({ ask: 'consent', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=S', state: 'S', redirectUri: 'https://kflow.academy/' }, undefined);
    expect(answered).toEqual({ reply: 'code', code: null });
    const status = await credentialStatusPayload(secretPorts, { credential: 'KNOWLEDGE_REFRESH_TOKEN', scope: 'app' }, undefined);
    expect(status).toEqual({ connected: true, label: 'ada@example.com' });
    expect(JSON.stringify([answered, status])).not.toContain('FIREBASE-RT');
    expect(await secretPorts.secrets.get('KNOWLEDGE_REFRESH_TOKEN')).toBe('FIREBASE-RT');
    expect(rows.rows.find((row) => row.envVar === 'KNOWLEDGE_REFRESH_TOKEN')?.label).toBe('ada@example.com');
    expect(JSON.stringify(rows.rows)).not.toContain('FIREBASE-RT');
  });

  it('a refresh-token rotation keeps the label, and forgetting drops the credential and the label with it', async () => {
    const { secretPorts, store } = await ports({ signIn: async () => ({ name: 'KNOWLEDGE_REFRESH_TOKEN', value: 'RT-1', label: 'ada@example.com' }) });
    await secretPorts.oauth?.answer({ ask: 'consent', authUrl: 'u', state: 'S', redirectUri: 'r' }, undefined);
    await secretPorts.secrets.rotate?.('KNOWLEDGE_REFRESH_TOKEN', 'RT-2');
    expect(await secretPorts.secrets.get('KNOWLEDGE_REFRESH_TOKEN')).toBe('RT-2');
    expect(store.label('KNOWLEDGE_REFRESH_TOKEN')).toBe('ada@example.com');
    expect(await credentialStatusPayload(secretPorts, { credential: 'KNOWLEDGE_REFRESH_TOKEN', scope: 'app' }, undefined)).toEqual({ connected: true, label: 'ada@example.com' });
    await secretPorts.secrets.forget('KNOWLEDGE_REFRESH_TOKEN');
    expect(await credentialStatusPayload(secretPorts, { credential: 'KNOWLEDGE_REFRESH_TOKEN', scope: 'app' }, undefined)).toEqual({ connected: false, label: '' });
    expect(store.label('KNOWLEDGE_REFRESH_TOKEN')).toBeUndefined();
    expect(await credentialForgetPayload(secretPorts, 'KNOWLEDGE_REFRESH_TOKEN', 'someone')).toEqual({ connected: false, label: '' });
  });

  it('control: a person who did not sign in keeps nothing, a failing sign-in keeps nothing and fails the ask, and no sign-in means no session', async () => {
    const declined = await ports({ signIn: async () => null });
    expect(await declined.secretPorts.oauth?.answer({ ask: 'consent', authUrl: 'u', state: 'S', redirectUri: 'r' }, undefined)).toEqual({ reply: 'code', code: null });
    expect(await credentialStatusPayload(declined.secretPorts, { credential: 'KNOWLEDGE_REFRESH_TOKEN', scope: 'app' }, undefined)).toEqual({ connected: false, label: '' });
    const failing = await ports({ signIn: async () => { throw new Error('Sign-in failed (400)'); } });
    await expect(failing.secretPorts.oauth?.answer({ ask: 'consent', authUrl: 'u', state: 'S', redirectUri: 'r' }, undefined)).rejects.toThrow('Sign-in failed');
    expect(failing.rows.rows).toEqual([]);
    const bare = await ports();
    expect(await bare.secretPorts.oauth?.answer({ ask: 'consent', authUrl: 'u', state: 'S', redirectUri: 'r' }, undefined)).toEqual({ reply: 'code', code: null });
    expect(bare.rows.rows).toEqual([]);
  });
});
