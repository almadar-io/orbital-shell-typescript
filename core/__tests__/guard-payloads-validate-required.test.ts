import { describe, expect, it } from 'vitest';
import { buildGuardPayloads, isRecognizedGuardOperator } from '../src/state-machine/guard-payloads.js';

describe('buildGuardPayloads — validate/required', () => {
  it('passes with a non-empty value and fails with an empty one', () => {
    const payloads = buildGuardPayloads(['validate/required', '@payload.id']);
    expect(payloads.pass).toEqual({ id: 'mock-required-value' });
    expect(payloads.fail).toEqual({ id: '' });
  });

  it('control: an entity-read guard is recognized but not steerable', () => {
    expect(isRecognizedGuardOperator('validate/required')).toBe(true);
    expect(buildGuardPayloads(['validate/required', '@entity.draft'])).toEqual({ pass: {}, fail: {} });
  });
});
