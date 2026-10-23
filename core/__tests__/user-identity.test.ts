/**
 * The `@user` identity contract: claim normalization and the dev identity token.
 *
 * Both execution paths resolve `@user.x` against `UserContext`, and four
 * consumers (mocked client, Express middleware, Hono middleware, emitted
 * backends) share the token codec — so a regression here silently disables every
 * ownership filter and role gate in the corpus rather than failing loudly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ANONYMOUS_USER,
  findPersonaInRoster,
  normalizeUserContext,
  personaFromIdentityRow,
  resolvePersonaSpec,
  type UserContext,
} from '../index';

/** A declared roster as an app's `[identity]` entity would seed it. */
const ROSTER: readonly UserContext[] = [
  { id: 'Person Id 1', name: 'Person 1', email: 'person1@example.com', role: 'member' },
  { id: 'Person Id 2', name: 'Person 2', email: 'person2@example.com', role: 'moderator' },
  { id: 'Person Id 3', name: 'Person 3', email: 'person3@example.com', role: 'admin' },
];

describe('normalizeUserContext', () => {
  it('maps a Firebase uid onto id and preserves uid', () => {
    const user = normalizeUserContext({ uid: 'firebase-abc', email: 'a@b.c' });
    expect(user?.id).toBe('firebase-abc');
    expect(user?.uid).toBe('firebase-abc');
    expect(user?.email).toBe('a@b.c');
  });

  it('maps displayName onto name and carries extra claims through', () => {
    const user = normalizeUserContext({ uid: 'u1', displayName: 'Ada L', tenantId: 't1' });
    expect(user?.name).toBe('Ada L');
    expect(user?.displayName).toBeUndefined();
    expect(user?.tenantId).toBe('t1');
  });

  it('prefers an explicit id and name over the provider aliases', () => {
    const user = normalizeUserContext({
      id: 'u1',
      uid: 'ignored',
      name: 'Real Name',
      displayName: 'Alias',
      role: 'admin',
      permissions: ['x'],
    });
    expect(user?.id).toBe('u1');
    expect(user?.name).toBe('Real Name');
    expect(user?.role).toBe('admin');
    expect(user?.permissions).toEqual(['x']);
  });

  it('drops a null email rather than surfacing it as a value', () => {
    const user = normalizeUserContext({ uid: 'u1', email: null });
    expect(user?.id).toBe('u1');
    expect(user?.email).toBeUndefined();
  });

  it('returns undefined without a usable subject', () => {
    expect(normalizeUserContext(undefined)).toBeUndefined();
    expect(normalizeUserContext(null)).toBeUndefined();
    expect(normalizeUserContext({})).toBeUndefined();
    expect(normalizeUserContext({ uid: '' })).toBeUndefined();
  });
});


describe('resolvePersonaSpec', () => {
  it('accepts a bare declared id or role', () => {
    expect(resolvePersonaSpec('Person Id 2', ROSTER).role).toBe('moderator');
    expect(resolvePersonaSpec(' admin ', ROSTER).id).toBe('Person Id 3');
  });

  it('accepts a full JSON UserContext with or without a roster', () => {
    const user = resolvePersonaSpec('{"id":"patient-7","role":"patient"}', []);
    expect(user.id).toBe('patient-7');
    expect(user.role).toBe('patient');
  });

  it('throws rather than booting as nobody', () => {
    expect(() => resolvePersonaSpec('who-dis', ROSTER)).toThrow(/not a declared persona/);
    expect(() => resolvePersonaSpec('{oops', ROSTER)).toThrow(/not valid JSON/);
    expect(() => resolvePersonaSpec('{"role":"admin"}', ROSTER)).toThrow(/needs an "id"/);
    expect(() => resolvePersonaSpec('["member-1"]', ROSTER)).toThrow(/not a declared persona/);
    expect(() => resolvePersonaSpec('{"id":""}', ROSTER)).toThrow(/needs an "id"/);
  });

  it('names the missing [identity] entity when the roster is empty', () => {
    expect(() => resolvePersonaSpec('member', [])).toThrow(/no \[identity\] entity/);
  });
});

describe('persona roster', () => {
  it('resolves by id and falls back to role', () => {
    expect(findPersonaInRoster(ROSTER, 'Person Id 1')?.role).toBe('member');
    expect(findPersonaInRoster(ROSTER, 'admin')?.id).toBe('Person Id 3');
    expect(findPersonaInRoster(ROSTER, 'nobody')).toBeUndefined();
  });

  it('maps an identity row onto a persona, requiring a string id', () => {
    const persona = personaFromIdentityRow({
      id: 'OnlineUser Id 4',
      name: 'Casey',
      role: 'moderator',
      status: 'online',
    });
    expect(persona?.id).toBe('OnlineUser Id 4');
    expect(persona?.role).toBe('moderator');
    expect(persona?.['status']).toBe('online');
    expect(personaFromIdentityRow({ name: 'No Id' })).toBeUndefined();
    expect(personaFromIdentityRow({ id: '' })).toBeUndefined();
  });

  it('never seeds an admin as the anonymous fallback', () => {
    expect(ANONYMOUS_USER.role).toBe('anonymous');
    expect(ANONYMOUS_USER.permissions).toEqual([]);
  });
});

