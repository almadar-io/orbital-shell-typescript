import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as wasm from '@almadar/kernel';
import type { JsonValue } from '@almadar/core';
import { createNodeOsHost } from '../src/os-node.js';
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


describe('raw Node network asks', () => {
  it('os/getenv answers no value key for an unset variable, as the table declares { value? } (twin of the Rust os host)', async () => {
    const host = createNodeOsHost({ allows: () => true, globMatches: () => false, isPublicAddress: () => false, anchor: () => [], resolveArgs: (_op, args) => ({ ok: args }) });
    try {
      expect(await host.answer('os/getenv', ['ZZ_NEVER_SET_X'])).toEqual({ ok: {} });
      expect(await host.answer('os/getenv', ['PATH'])).toEqual({ ok: { value: process.env.PATH } });
    } finally { host.close(); }
  });

  it('refuses tcp-listen without stream context using the shared canonical host fixture', async () => {
    const fixture: { steps: Array<{ op?: string; key?: string; args?: JsonValue[]; expect?: JsonValue }> } = JSON.parse(readFileSync(new URL('./fixtures/os-asks.json', import.meta.url), 'utf8'));
    const step = fixture.steps.find((entry) => entry.op === 'os/tcp-listen' && entry.key === undefined);
    if (step?.args === undefined || step.expect === undefined) throw new Error('missing unkeyed listener fixture');
    const host = createNodeOsHost({ allows: () => false, globMatches: () => false, isPublicAddress: () => false, anchor: () => [], resolveArgs: (_op, args) => ({ ok: args }) });
    try {
      expect(await host.answer('os/tcp-listen', step.args)).toEqual(step.expect);
      expect(await host.answer('os/tcp-connect', ['127.0.0.1', 1])).toMatchObject({ error: { kind: 'denied' } });
      expect(await host.answer('os/watch-port', [])).toMatchObject({ error: { kind: 'unsupported' } });
    } finally { host.close(); }
  });

  it('refuses os/fetch typed, naming the ports it speaks HTTP over (twin of the Rust os host)', async () => {
    const host = createNodeOsHost({ allows: () => true, globMatches: () => false, isPublicAddress: () => false, anchor: () => [], resolveArgs: (_op, args) => ({ ok: args }) });
    try {
      const refused = await host.answer('os/fetch', ['GET', 'https://a.example.test/']);
      expect(refused).toMatchObject({ error: { kind: 'unsupported' } });
      expect(JSON.stringify(refused)).toContain('os/tcp-connect');
      expect(await host.answer('os/fetch', ['GET', 'https://a.example.test/', { stream: true }])).toMatchObject({ error: { kind: 'unsupported' } });
      expect(await host.answer('os/exists', ['/'])).not.toMatchObject({ error: { kind: 'unsupported' } });
    } finally { host.close(); }
  });
});
