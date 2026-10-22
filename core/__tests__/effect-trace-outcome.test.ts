import { describe, expect, it } from 'vitest';

import type { EffectTrace } from '../src/types/verification.js';

/**
 * C1-V1: `EffectTrace` += `action` / `resultId` / `outcome` — the persist
 * effect's real outcome, distinct from `status` (kept for back-compat with
 * consumers that only branch on it). Round-trip pin: every new field is
 * optional (a pre-existing producer that sets none of them stays valid),
 * and `outcome: 'denied'` coexists with `status: 'failed'` rather than
 * replacing it.
 */
describe('EffectTrace — action/resultId/outcome', () => {
  it('accepts a trace with no new fields (back-compat with existing producers)', () => {
    const trace: EffectTrace = { type: 'render-ui', args: [], status: 'executed' };
    expect(trace.action).toBeUndefined();
    expect(trace.resultId).toBeUndefined();
    expect(trace.outcome).toBeUndefined();
  });

  it('carries a denied persist as status:"failed" + outcome:"denied" together', () => {
    const trace: EffectTrace = {
      type: 'persist',
      entityName: 'Ticket',
      action: 'delete',
      args: [],
      status: 'failed',
      outcome: 'denied',
      error: "@delete denied: the declared access policy for 'Ticket' rejected this row",
    };
    expect(trace.status).toBe('failed');
    expect(trace.outcome).toBe('denied');
  });

  it('carries a successful create with its resulting id', () => {
    const trace: EffectTrace = {
      type: 'persist',
      entityName: 'Ticket',
      action: 'create',
      resultId: 't-9',
      args: [],
      status: 'executed',
      outcome: 'success',
    };
    expect(trace.resultId).toBe('t-9');
    expect(trace.outcome).toBe('success');
  });

  it('every declared action value type-checks', () => {
    const actions: NonNullable<EffectTrace['action']>[] = ['create', 'update', 'delete', 'batch'];
    for (const action of actions) {
      const trace: EffectTrace = { type: 'persist', action, args: [], status: 'executed' };
      expect(trace.action).toBe(action);
    }
  });
});
