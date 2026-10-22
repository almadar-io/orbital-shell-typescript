import { describe, expect, it } from 'vitest';
import { credentialStorageKey, type CredentialIdentity } from '../src/types/index.js';
import { credentialStatusConnected, resolveCredentialStatusIdentity } from '../src/types/service.js';
import type { RuntimeValue } from '../src/types/json.js';

describe('credential storage identity', () => {
  it('keeps app and user identities injective for arbitrary string names and principals', () => {
    const identities: CredentialIdentity[] = [
      { name: 'user:a:b:c' },
      { name: 'c', principal: 'a:b' },
      { name: 'b:c', principal: 'a' },
      { name: '["u1","KEY"]' },
      { name: 'KEY', principal: 'u1' },
      { name: 'KEY', principal: '' },
      { name: 'KEY' },
    ];
    expect(new Set(identities.map(credentialStorageKey)).size).toBe(identities.length);
  });

  it('control: equivalent identities are stable and user identity never becomes app identity', () => {
    expect(credentialStorageKey({ name: 'KEY' })).toBe(credentialStorageKey({ name: 'KEY', principal: undefined }));
    expect(credentialStorageKey({ name: 'KEY' })).not.toBe(credentialStorageKey({ name: 'KEY', principal: 'u1' }));
  });
});

describe('credential status selection', () => {
  it('keeps a bare selection user-scoped and resolves only explicit app selections without a viewer', () => {
    expect(resolveCredentialStatusIdentity('KEY', 'u1')).toEqual({ name: 'KEY', principal: 'u1' });
    expect(resolveCredentialStatusIdentity({ credential: 'KEY', scope: 'user' }, 'u1')).toEqual({ name: 'KEY', principal: 'u1' });
    for (const principal of [undefined, 'u1']) {
      expect(resolveCredentialStatusIdentity({ credential: 'KEY', scope: 'app' }, principal)).toEqual({ name: 'KEY' });
    }
    for (const selection of ['KEY', { credential: 'KEY', scope: 'user' }]) {
      expect(() => resolveCredentialStatusIdentity(selection, undefined)).toThrow('credential-status: nobody is signed in');
    }
  });

  it('rejects malformed or principal-forging scoped selections', () => {
    const inherited = {};
    Object.setPrototypeOf(inherited, { credential: 'KEY', scope: 'app' });
    const malformed: RuntimeValue[] = [
      { credential: 'KEY' }, { credential: 'KEY', scope: 'world' }, { scope: 'app' },
      { credential: 7, scope: 'app' }, { credential: 'KEY', scope: 'app', principal: 'evil' },
      { credential: 'KEY', scope: 'app', extra: true }, [], new Date(0),
      inherited,
    ];
    for (const selection of malformed) {
      expect(() => resolveCredentialStatusIdentity(selection, 'u1')).toThrow();
    }
    expect(() => resolveCredentialStatusIdentity(7, 'u1')).toThrow("credential-status: the credential must be a secret knob's name");
    expect(() => resolveCredentialStatusIdentity(7, undefined)).toThrow('credential-status: nobody is signed in');
  });

  it('snapshots an accessor-backed credential once before selecting its identity', () => {
    for (const scope of ['app', 'user']) {
      let credentialReads = 0;
      const selection = {
        get credential() { return ++credentialReads === 1 ? 'KEY' : 'OTHER_KEY'; },
        scope,
      };
      expect(resolveCredentialStatusIdentity(selection, 'u1')).toEqual(
        scope === 'app' ? { name: 'KEY' } : { name: 'KEY', principal: 'u1' },
      );
      expect(credentialReads).toBe(1);
    }
  });

  it('cannot validate a user scope and then switch to app authority without a viewer', () => {
    let credentialReads = 0;
    let scopeReads = 0;
    const selection = {
      get credential() { credentialReads += 1; return 'KEY'; },
      get scope() { return ++scopeReads < 3 ? 'user' : 'app'; },
    };
    expect(() => resolveCredentialStatusIdentity(selection, undefined)).toThrow('credential-status: nobody is signed in');
    expect(credentialReads).toBe(1);
    expect(scopeReads).toBe(1);
  });

  it('rejects non-closed keys before reading either selection accessor', () => {
    let credentialReads = 0;
    let scopeReads = 0;
    const malformed = [
      {
        get credential() { credentialReads += 1; return 'KEY'; },
        get scope() { scopeReads += 1; return 'app'; },
        principal: 'forged',
      },
      { get credential() { credentialReads += 1; return 'KEY'; } },
      { get scope() { scopeReads += 1; return 'app'; } },
    ];
    for (const selection of malformed) {
      expect(() => resolveCredentialStatusIdentity(selection, undefined)).toThrow('credential-status: expected { credential, scope: app | user }');
    }
    expect(credentialReads).toBe(0);
    expect(scopeReads).toBe(0);
  });

  it('uses presence for users and nonempty presence for the app', () => {
    for (const value of [undefined, '']) expect(credentialStatusConnected(value, undefined)).toBe(false);
    expect(credentialStatusConnected('token', undefined)).toBe(true);
    expect(credentialStatusConnected(undefined, 'u1')).toBe(false);
    expect(credentialStatusConnected('', 'u1')).toBe(true);
    expect(credentialStatusConnected('token', 'u1')).toBe(true);
    expect(resolveCredentialStatusIdentity('KEY', '')).toEqual({ name: 'KEY', principal: '' });
    expect(credentialStatusConnected('', '')).toBe(true);
  });
});
