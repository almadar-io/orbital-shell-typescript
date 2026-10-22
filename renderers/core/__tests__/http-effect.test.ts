import { describe, it, expect } from 'vitest';
import { EFFECT_OPERATORS, SERVER_REPORTED_EFFECTS } from '../src/types/effect.js';
import type { HttpCall, HttpEffect, HttpReplyPayload, HttpPagedPayload, HttpPresignedPayload, HttpFailurePayload, HttpStreamEvent } from '../src/types/index.js';
import { OrbitalSchemaSchema } from '../src/types/schema.js';

const base = {
  name: 'IconDemo',
  orbitals: [{ name: 'O', entity: { name: 'E', fields: [{ name: 'name', type: 'string' }] }, traits: [], pages: [] }],
};

describe('http effect', () => {
  it('exports canonical execution metadata without adding an authored request option', () => {
    const call: HttpCall = { method: 'GET', origin: 'https://a.test', path: '/', request: {}, nowMs: 1700000000000 };
    expect(call.nowMs).toBe(1700000000000);
    expect(call.request.nowMs).toBeUndefined();
    const signed: HttpPresignedPayload = { url: 'https://a.test/?signature=fixture', key: null };
    expect(signed.key).toBeNull();
  });
  it('is a server-reported effect and an effect operator, once', () => {
    expect(SERVER_REPORTED_EFFECTS).toContain('http');
    expect(EFFECT_OPERATORS.filter((o) => o === 'http')).toHaveLength(1);
    expect(SERVER_REPORTED_EFFECTS).toContain('call-service');
  });

  it('types the tuple and payloads', () => {
    const e: HttpEffect = ['http', 'GET', 'https://a.test', '/x', { query: { q: 1 } }, { key: 'k', emit: { success: 'OK' } }];
    const reply: HttpReplyPayload = { status: 200, headers: { a: 'b' }, body: '', key: 'k' };
    const paged: HttpPagedPayload<number> = { pages: 1, items: [1], last: reply, key: 'k' };
    const fail: HttpFailurePayload = { error: 'x', kind: 'refused', credential: null, phase: null, grantStatus: null, grantBody: null, code: null, reason: null, key: null };
    const ev: HttpStreamEvent = { data: 'd', event: null, id: null, key: 'k' };
    expect([e[0], paged.pages, fail.kind, ev.id]).toEqual(['http', 1, 'refused', null]);
  });

  it('types the credential name only on an unconfigured failure', () => {
    const absent: HttpFailurePayload = { error: 'missing', kind: 'unconfigured', credential: 'KEY', phase: null, grantStatus: null, grantBody: null, code: null, reason: null, key: 'job' };
    // @ts-expect-error An unconfigured failure requires the credential name.
    const missingName: HttpFailurePayload = { error: 'missing', kind: 'unconfigured', credential: null, phase: null, grantStatus: null, grantBody: null, code: null, reason: null, key: null };
    // @ts-expect-error Other failure kinds carry a null credential.
    const unexpectedName: HttpFailurePayload = { error: 'refused', kind: 'refused', credential: 'KEY', phase: null, grantStatus: null, grantBody: null, code: null, reason: null, key: null };
    expect(absent).toMatchObject({ kind: 'unconfigured', credential: 'KEY', key: 'job' });
    expect([missingName.credential, unexpectedName.credential]).toEqual([null, 'KEY']);
  });

  it('types the grant phase, the oauth code/reason and the unavailable kind', () => {
    const grant: HttpFailurePayload = { error: 'x', kind: 'failed', credential: null, phase: 'grant', grantStatus: 401, grantBody: '{}', code: null, reason: null, key: null };
    const oauth: HttpFailurePayload = { error: 'x', kind: 'oauth', credential: null, phase: null, grantStatus: null, grantBody: null, code: 'AUTH_ERROR', reason: 'state-unknown', key: null };
    const unavailable: HttpFailurePayload = { error: 'x', kind: 'unavailable', credential: null, phase: null, grantStatus: null, grantBody: null, code: null, reason: null, key: null };
    // @ts-expect-error code and reason belong to oauth only.
    const stray: HttpFailurePayload = { error: 'x', kind: 'failed', credential: null, phase: null, grantStatus: null, grantBody: null, code: 'AUTH_ERROR', reason: null, key: null };
    // @ts-expect-error reason is a closed set.
    const wrongReason: HttpFailurePayload = { error: 'x', kind: 'oauth', credential: null, phase: null, grantStatus: null, grantBody: null, code: 'AUTH_ERROR', reason: 'other', key: null };
    expect([grant.kind, oauth.kind, unavailable.kind, stray.kind, wrongReason.kind]).toEqual(['failed', 'oauth', 'unavailable', 'failed', 'oauth']);
  });
});

describe('OrbitalSchema.egress', () => {
  it('round-trips', () => {
    const r = OrbitalSchemaSchema.safeParse({ ...base, egress: ['https://api.iconify.design'] });
    expect(r.success && r.data.egress).toEqual(['https://api.iconify.design']);
  });
  it('is optional (control)', () => {
    const r = OrbitalSchemaSchema.safeParse(base);
    expect(r.success && r.data.egress).toBeUndefined();
  });
  it('rejects non-strings and empty entries', () => {
    expect(OrbitalSchemaSchema.safeParse({ ...base, egress: [1] }).success).toBe(false);
    expect(OrbitalSchemaSchema.safeParse({ ...base, egress: [''] }).success).toBe(false);
  });
});
