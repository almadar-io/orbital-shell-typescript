import { describe, expect, it } from 'vitest';
import { buildGuardPayloads, isRecognizedGuardOperator } from '../src/state-machine/guard-payloads.js';

describe('buildGuardPayloads — validate/url', () => {
  it('passes with a parseable URL and fails with a non-URL', () => {
    const payloads = buildGuardPayloads(['validate/url', '@payload.origin']);
    expect(payloads.pass).toEqual({ origin: 'https://example.test/mock' });
    expect(payloads.fail).toEqual({ origin: 'not-a-url' });
    expect(() => new URL(String(payloads.pass.origin))).not.toThrow();
    expect(() => new URL(String(payloads.fail.origin))).toThrow();
  });

  it('control: an entity-read guard is recognized but not steerable', () => {
    expect(isRecognizedGuardOperator('validate/url')).toBe(true);
    expect(buildGuardPayloads(['validate/url', '@entity.draft'])).toEqual({ pass: {}, fail: {} });
  });
});
