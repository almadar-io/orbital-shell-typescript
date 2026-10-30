// The credential-holding secret ports of a browser-extension host: the profile's credential vault (the kernel's encrypted store) answers every
// secret ask, and the build's provisioned credentials back it up for the app-wide slot only.
import { describe, expect, it } from 'vitest';
import { CredentialVault, type CredentialRowsPort } from '@almadar/shell-web';
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
});
