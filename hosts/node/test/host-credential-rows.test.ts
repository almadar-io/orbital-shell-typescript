// The Node host's credential rows: the native host's encrypted file, answered as raw rows for the kernel's vault. The
// built kernel does the encryption and every failure rule, so these tests run it.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as wasm from '@almadar/kernel';
import { EntityRowSchema, type EntityRow, type JsonValue } from '@almadar/core';
import { getInstalledCredentialStore, uninstallCredentialStore } from '@almadar/shell-runtime';
import { credentialsFilePath, DEFAULT_CREDENTIALS_FILE, fileCredentialRows, installNodeCredentialVault } from '../src/index.js';

wasm.initSync({ module: readFileSync(createRequire(import.meta.url).resolve('@almadar/kernel/kernel.wasm')) });

const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const fixture: { masterKey: string; previousKey: string; rows: JsonValue[] } = JSON.parse(readFileSync(new URL('./fixtures/credential-store.json', import.meta.url), 'utf8'));

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'credential-rows-'));
  const file = join(dir, 'nested', 'credentials.json');
  return { dir, file, env: { ALMADAR_CREDENTIAL_MASTER_KEY: KEY, ALMADAR_CREDENTIALS_FILE: file } };
}

function rowsOf(file: string): EntityRow[] {
  return EntityRowSchema.array().parse(JSON.parse(readFileSync(file, 'utf8')));
}

describe('node credential rows', () => {
  afterEach(() => uninstallCredentialStore());

  it('keeps the vault durable in the native file layout: ciphertext rows, a label in the clear, read back by a later host', async () => {
    const { file, env } = workspace();
    const vault = await installNodeCredentialVault({ kernel: wasm, env });
    expect(vault).not.toBeNull();
    expect(getInstalledCredentialStore()).toBe(vault);
    await vault?.set('kernel', 'REFRESH_TOKEN', 'RT-SECRET-0001', undefined, 'ada@example.com');
    const text = readFileSync(file, 'utf8');
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    expect(text).toContain('ada@example.com');
    expect(text).not.toContain('RT-SECRET-0001');
    expect(rowsOf(file)).toHaveLength(1);
    const later = await installNodeCredentialVault({ kernel: wasm, env });
    expect(later?.resolve('REFRESH_TOKEN')).toBe('RT-SECRET-0001');
    expect(later?.label('REFRESH_TOKEN')).toBe('ada@example.com');
    await later?.remove('REFRESH_TOKEN');
    expect(rowsOf(file)).toEqual([]);
  });

  it('lists the last four characters of a secret of eight or more and nothing for a shorter one', async () => {
    const { env } = workspace();
    const vault = await installNodeCredentialVault({ kernel: wasm, env });
    await vault?.set('stripe', 'LONG_KEY', 'sk-live-abcd1234');
    await vault?.set('stripe', 'SHORT_KEY', 'sk-1234');
    expect(vault?.listing()).toEqual({
      enabled: true,
      entries: [
        { service: 'stripe', name: 'LONG_KEY', last4: '1234' },
        { service: 'stripe', name: 'SHORT_KEY' },
      ],
    });
  });

  it('reads rows the native host wrote: the shared fixture opens to the plaintexts, rotation window included', async () => {
    const { file } = workspace();
    const rows = fileCredentialRows(file);
    for (const row of fixture.rows) await rows.create(EntityRowSchema.parse(row) as EntityRow & { id: string });
    const vault = await installNodeCredentialVault({
      kernel: wasm,
      env: { ALMADAR_CREDENTIAL_MASTER_KEY: fixture.masterKey, ALMADAR_CREDENTIAL_MASTER_KEY_PREVIOUS: fixture.previousKey, ALMADAR_CREDENTIALS_FILE: file },
    });
    expect(vault?.resolve('STRIPE_KEY')).toBe('fake-stripe-1234');
    expect(vault?.resolve('OPENAI_KEY', 'user-7')).toBe('fake-user-ü-9876');
    expect(vault?.resolve('GITHUB_TOKEN')).toBe('fake-github-5555');
  });

  it('control: with no master key the host has no store, and the file path is the native default under the working directory', async () => {
    const { dir } = workspace();
    expect(await installNodeCredentialVault({ kernel: wasm, env: {}, cwd: dir })).toBeNull();
    expect(getInstalledCredentialStore()).toBeNull();
    expect(credentialsFilePath({}, dir)).toBe(join(dir, DEFAULT_CREDENTIALS_FILE));
    expect(credentialsFilePath({ ALMADAR_CREDENTIALS_FILE: '' }, dir)).toBe(join(dir, DEFAULT_CREDENTIALS_FILE));
    expect(credentialsFilePath({ ALMADAR_CREDENTIALS_FILE: '/x/y.json' }, dir)).toBe('/x/y.json');
    const vault = await installNodeCredentialVault({ kernel: wasm, env: { ALMADAR_CREDENTIAL_MASTER_KEY: KEY }, cwd: dir });
    await vault?.set('kernel', 'K', 'v');
    expect(rowsOf(join(dir, DEFAULT_CREDENTIALS_FILE))).toHaveLength(1);
  });

  it('control: a missing file is an empty store, and every unreadable file or row fails the open instead of reading as empty', async () => {
    const { file, env } = workspace();
    expect((await installNodeCredentialVault({ kernel: wasm, env }))?.entries()).toEqual([]);

    const vault = await installNodeCredentialVault({ kernel: wasm, env });
    await vault?.set('kernel', 'A', 'value-A');
    await vault?.set('kernel', 'B', 'value-B');
    const [good, bad] = rowsOf(file);
    writeFileSync(file, JSON.stringify([good, { ...bad, authTag: '00'.repeat(16) }], null, 2));
    const failure = await installNodeCredentialVault({ kernel: wasm, env }).then(
      () => undefined,
      (error: Error) => error.message,
    );
    expect(failure).toContain(String(bad.id));
    expect(failure).not.toContain(String(good.id));

    writeFileSync(file, '{ not json');
    await expect(installNodeCredentialVault({ kernel: wasm, env })).rejects.toThrow(`credential file ${file} is not JSON`);
    writeFileSync(file, JSON.stringify({ rows: [] }));
    await expect(installNodeCredentialVault({ kernel: wasm, env })).rejects.toThrow('is not an array of rows');
    writeFileSync(file, JSON.stringify([{ envVar: 'X' }]));
    await expect(installNodeCredentialVault({ kernel: wasm, env })).rejects.toThrow('carries no id');
    await expect(installNodeCredentialVault({ kernel: wasm, env: { ...env, ALMADAR_CREDENTIAL_MASTER_KEY: 'short' } })).rejects.toThrow('64 hex digits');
  });

  it('answers the conditional delete: true for the call that removed the row, false after', async () => {
    const { file } = workspace();
    const rows = fileCredentialRows(file);
    await rows.create({ id: 'r1', envVar: 'X' });
    await rows.update('r1', { service: 's' });
    expect(await rows.list()).toEqual([{ id: 'r1', envVar: 'X', service: 's' }]);
    expect(await rows.delete('r1')).toBe(true);
    expect(await rows.delete('r1')).toBe(false);
    expect(await rows.list()).toEqual([]);
  });
});
