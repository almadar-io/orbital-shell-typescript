/**
 * A `(quote …)` form is constant data — a quoted guard (e.g. one shown in a state-machine
 * picture) is never evaluated, so there is no payload to steer and nothing to warn about.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildGuardPayloads, isRecognizedGuardOperator } from '../src/state-machine/guard-payloads.js';

describe('quoted guards', () => {
  it('quote is a recognized guard operator', () => {
    expect(isRecognizedGuardOperator('quote')).toBe(true);
  });

  it('a quoted guard synthesizes nothing and warns nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(buildGuardPayloads(['quote', '[">","\\u0040payload.amount",0]'])).toEqual({ pass: {}, fail: {} });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('control: an unknown operator is still unrecognized', () => {
    expect(isRecognizedGuardOperator('no-such-op')).toBe(false);
  });
});
