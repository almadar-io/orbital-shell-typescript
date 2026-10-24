/**
 * Declared inbound deliveries — twin of `orbital-core` `inbound.rs` (EXEC-INBOUND-1): the same
 * routes, the same payload, the same answers.
 */

import { describe, it, expect } from 'vitest';
import {
  findInbound,
  constantTimeEquals,
  inboundAnswerOf,
  inboundOnlyTrait,
  inboundPayload,
  inboundRoutesOf,
  unknownHook,
  type InboundRoute,
  type OrbitalSchema,
} from '../index';

function schemaOf(inbound: string[] | undefined, secondHandler = false): OrbitalSchema {
  return {
    name: 'App',
    ...(inbound !== undefined ? { inbound } : {}),
    orbitals: [
      {
        name: 'CalOrbital',
        entity: { name: 'Req', collection: 'reqs', persistence: 'runtime', fields: [{ name: 'id', type: 'string', required: true }] },
        traits: [
          {
            name: 'Inbound',
            linkedEntity: 'Req',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [
                { key: 'INIT', name: 'Init' },
                { key: 'PUSH', name: 'Push', listened: true, inbound: { name: 'google-calendar', answers: 'PUSH_ANSWERED' } },
                ...(secondHandler ? [{ key: 'PUSH_AGAIN', name: 'Again', inbound: { name: 'google-calendar', answers: 'PUSH_ANSWERED' } }] : []),
              ],
              transitions: [{ from: 'idle', to: 'idle', event: 'PUSH' }],
            },
          },
        ],
        pages: [],
      },
    ],
  };
}

const route: InboundRoute = { name: 'google-calendar', orbital: 'CalOrbital', trait: 'Inbound', event: 'PUSH', answer: 'PUSH_ANSWERED' };

describe('findInbound', () => {
  it('finds a handler the app declares by name', () => {
    expect(findInbound(schemaOf(['google-calendar']), 'google-calendar')).toEqual(route);
    expect(inboundRoutesOf(schemaOf([]))).toEqual([route]);
  });

  it('control: a handler the app does not declare, a name nobody handles and a name two traits handle are not served', () => {
    expect(findInbound(schemaOf([]), 'google-calendar')).toBeUndefined();
    expect(findInbound(schemaOf(undefined), 'google-calendar')).toBeUndefined();
    expect(findInbound(schemaOf(['slack']), 'slack')).toBeUndefined();
    expect(findInbound(schemaOf(['google-calendar'], true), 'google-calendar')).toBeUndefined();
  });

  it('answers an unserved name with the retired router’s 404 body', () => {
    expect(unknownHook('x')).toEqual({ status: 404, body: '{"error":"Unknown hook provider: x"}' });
  });
});

describe('inboundPayload', () => {
  it('lower-cases header names, joins repeats, parses the body and keeps the raw text', () => {
    const payload = inboundPayload(route, { headers: { 'X-Goog-Channel-Id': 'c1', Accept: 'a', accept: 'b', Skipped: undefined }, rawBody: '{"k":1}' });
    expect(payload).toEqual({ headers: { 'x-goog-channel-id': 'c1', accept: 'a, b' }, body: { k: 1 }, rawBody: '{"k":1}' });
  });

  it('control: an empty or non-JSON body is null and the raw text is kept', () => {
    for (const rawBody of ['', 'not json']) {
      expect(inboundPayload(route, { headers: {}, rawBody })).toEqual({ headers: {}, body: null, rawBody });
    }
  });
});

describe('inboundAnswerOf', () => {
  it('is the first emit of the answer event', () => {
    const answer = inboundAnswerOf(route, [
      { event: 'OTHER', payload: {} },
      { event: 'PUSH_ANSWERED', payload: { status: 400, body: '{"error":"bad-token"}' } },
      { event: 'PUSH_ANSWERED', payload: { status: 200, body: '{}' } },
    ]);
    expect(answer).toEqual({ status: 400, body: '{"error":"bad-token"}' });
  });

  it('control: no answer, a failure and a malformed answer are 500s', () => {
    expect(inboundAnswerOf(route, [])).toEqual({ status: 500, body: '{"error":"inbound-unanswered"}' });
    expect(inboundAnswerOf(route, [], 'boom')).toEqual({ status: 500, body: '{"error":"boom"}' });
    for (const payload of [{ status: '200', body: '{}' }, { status: 200.5, body: '{}' }, { status: 99, body: '{}' }, { status: 600, body: '{}' }, { status: 200, body: 1 }]) {
      expect(inboundAnswerOf(route, [{ event: 'PUSH_ANSWERED', payload }])).toEqual({ status: 500, body: '{"error":"inbound-answer-invalid"}' });
    }
  });
});

describe('verification', () => {
  const verifying: InboundRoute = { ...route, verifies: { header: 'x-goog-channel-token', credential: 'CHANNEL_TOKEN' } };
  const verified = (token: string | undefined, credential: string | null | undefined) =>
    inboundPayload(verifying, { headers: token === undefined ? {} : { 'X-Goog-Channel-Token': token }, rawBody: '' }, credential).verified;

  it('compares the named header with the credential and keeps the credential out of the payload', () => {
    expect(verified('s3cret', 's3cret')).toBe(true);
    expect(verified('wrong', 's3cret')).toBe(false);
    expect(verified(undefined, 's3cret')).toBe(false);
    expect(JSON.stringify(inboundPayload(verifying, { headers: { 'X-Goog-Channel-Token': 'wrong' }, rawBody: '' }, 's3cret'))).not.toContain('s3cret');
  });

  it('an unset or empty credential means unchecked, and a route with no verifies carries no verified field', () => {
    expect(verified('anything', undefined)).toBe(true);
    expect(verified('anything', null)).toBe(true);
    expect(verified(undefined, '')).toBe(true);
    expect(inboundPayload(route, { headers: {}, rawBody: '' }, 's3cret')).not.toHaveProperty('verified');
  });

  it('the comparison is exact for unequal lengths and non-ASCII text', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals('', 'a')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
    expect(constantTimeEquals('tökén', 'tökén')).toBe(true);
    expect(constantTimeEquals('tökén', 'token')).toBe(false);
  });
});

describe('inboundOnlyTrait', () => {
  it('names the handler trait of an inbound event and nothing else', () => {
    const schema = schemaOf(['google-calendar']);
    expect(inboundOnlyTrait(schema, 'CalOrbital', 'Inbound', 'PUSH')).toBe('Inbound');
    expect(inboundOnlyTrait(schema, 'CalOrbital', undefined, 'PUSH')).toBe('Inbound');
    expect(inboundOnlyTrait(schema, 'CalOrbital', 'Other', 'PUSH')).toBeUndefined();
    expect(inboundOnlyTrait(schema, 'CalOrbital', 'Inbound', 'INIT')).toBeUndefined();
    expect(inboundOnlyTrait(schema, 'OtherOrbital', undefined, 'PUSH')).toBeUndefined();
  });
});
