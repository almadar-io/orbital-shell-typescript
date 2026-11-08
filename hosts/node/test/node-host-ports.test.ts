import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as wasm from '@almadar/kernel';
import { describe, expect, it } from 'vitest';
import { CredentialVault, getEffectiveCredentialStore, runWithCredentialScope, type CredentialRowsPort } from '@almadar/shell-runtime';
import { installNodeHostPorts } from '../src/index.js';

wasm.initSync({ module: readFileSync(createRequire(import.meta.url).resolve('@almadar/kernel/kernel.wasm')) });

describe('node host ports', () => {
  const rows: CredentialRowsPort = { create: async () => undefined, update: async () => undefined, delete: async () => undefined, list: async () => [] };
  const keylessVault = (): Promise<CredentialVault> => CredentialVault.open(new wasm.CredentialVault(), rows);

  it('without installed ports a tenant scope is refused', async () => {
    const vault = await keylessVault();
    expect(() => runWithCredentialScope(vault, () => 1)).toThrow(/CredentialScopeStorage/);
  });

  it('installed, tenant scopes carry across awaits', async () => {
    installNodeHostPorts();
    const store = await keylessVault();
    const seen = await runWithCredentialScope(store, async () => {
      await Promise.resolve();
      return getEffectiveCredentialStore();
    });
    expect(seen).toBe(store);
    expect(getEffectiveCredentialStore()).toBeNull();
  });
});

