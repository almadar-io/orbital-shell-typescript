/**
 * C1-V1: `mapServerEffectResults` — the compiled-path bus payload → core
 * `EffectTrace` mapping VerificationProvider uses for `{trait}:{event}:SUCCESS`
 * lifecycle events. Pinned as a pure function (no bus/React) so the entity
 * key + outcome derivation are covered directly.
 */
import { describe, it, expect } from 'vitest';
import { mapServerEffectResults } from '../VerificationProvider';

describe('mapServerEffectResults', () => {
  it('reads entityType (the field the server actually writes), not entity', () => {
    const [trace] = mapServerEffectResults([
      { effect: 'persist', action: 'create', entityType: 'Ticket', success: true, data: { id: 't1' } },
    ]);
    expect(trace.entityName).toBe('Ticket');
    expect(trace.action).toBe('create');
    expect(trace.resultId).toBe('t1');
    expect(trace.outcome).toBe('success');
    expect(trace.status).toBe('executed');
  });

  it('marks outcome "denied" and status "failed" for a denied persist', () => {
    const [trace] = mapServerEffectResults([
      {
        effect: 'persist',
        action: 'delete',
        entityType: 'Ticket',
        success: false,
        denied: true,
        error: "@delete denied: the declared access policy for 'Ticket' rejected this row",
      },
    ]);
    expect(trace.outcome).toBe('denied');
    expect(trace.status).toBe('failed');
    expect(trace.error).toMatch(/denied/);
  });

  it('marks outcome "failed" (not "denied") for a non-policy failure', () => {
    const [trace] = mapServerEffectResults([
      { effect: 'persist', action: 'create', entityType: 'Ticket', success: false, error: 'backend unavailable' },
    ]);
    expect(trace.outcome).toBe('failed');
    expect(trace.status).toBe('failed');
  });

  it('falls back to entity/service when entityType is absent (older servers)', () => {
    const [trace] = mapServerEffectResults([
      { effect: 'call-service', service: 'billing', success: true },
    ]);
    expect(trace.entityName).toBe('billing');
  });

  it('drops resultId when data carries no string id', () => {
    const [trace] = mapServerEffectResults([
      { effect: 'persist', action: 'batch', success: true, data: { completedCount: 3, totalCount: 3 } },
    ]);
    expect(trace.resultId).toBeUndefined();
    expect(trace.action).toBe('batch');
  });
});
