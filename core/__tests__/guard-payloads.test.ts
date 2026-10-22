/**
 * Coverage of the `and`-handler bare-string sub-guard fix in
 * `buildGuardPayloads`. Before the fix the `and` branch ran
 * `filter(Array.isArray)` over its sub-guards, silently dropping
 * bare-binding existence guards like `"@payload.row"` from the pass
 * payload. The `or` branch already kept them. These tests pin that an
 * `and` over a mix of bare-string and array sub-guards seeds BOTH fields.
 */

import { describe, it, expect } from 'vitest';
import { buildGuardPayloads, constTruth } from '../src/state-machine/guard-payloads.js';

describe('buildGuardPayloads — and-handler bare-string sub-guards', () => {
  it('seeds pass for BOTH a bare-string and an array sub-guard', () => {
    const { pass, fail } = buildGuardPayloads(['and', '@payload.a', ['not-nil', '@payload.b']]);
    expect(pass.a).toBeDefined();
    expect(pass.a).not.toBeNull();
    expect(pass.b).toBeDefined();
    expect(pass.b).not.toBeNull();
    // AND fails iff any sub-guard fails — first sub-guard's fail is sufficient.
    expect(fail.a).toBeNull();
  });

  it('preserves AND pass-merge semantics for two array sub-guards', () => {
    const { pass } = buildGuardPayloads([
      'and',
      ['not-nil', '@payload.id'],
      ['eq', '@payload.status', 'ready'],
    ]);
    expect(pass.id).toBe('mock-test-value');
    expect(pass.status).toBe('ready');
  });

  it('handles three sub-guards including a bare string', () => {
    const { pass } = buildGuardPayloads([
      'and',
      '@payload.row',
      ['not-nil', '@payload.id'],
      ['eq', '@payload.status', 'ready'],
    ]);
    expect(pass.row).toBeDefined();
    expect(pass.id).toBe('mock-test-value');
    expect(pass.status).toBe('ready');
  });

  it('constTruth folds fully-literal guards and leaves binding guards null', () => {
    // The create-mode modal OPEN guard, post-inline.
    expect(constTruth(['or', ['=', 'create', 'create'], '@payload.row'])).toBe(true);
    expect(constTruth(['=', 'edit', 'create'])).toBe(false);
    expect(constTruth(['and', ['=', 'a', 'a'], ['!=', 'x', 'y']])).toBe(true);
    expect(constTruth(['and', ['=', 'a', 'b'], '@payload.row'])).toBe(false); // short-circuit false
    expect(constTruth('@payload.row')).toBeNull(); // binding remains
    expect(constTruth(['=', '@entity.status', 'active'])).toBeNull();
  });

  it('synthesizes an empty payload for a constant (always-true) guard', () => {
    // No field to satisfy — the literals decide it; a spurious row would put a
    // create-mode modal into a failing edit-load (the std-cart divergence).
    const { pass, fail } = buildGuardPayloads(['or', ['=', 'create', 'create'], '@payload.row']);
    expect(pass).toEqual({});
    expect(fail).toEqual({});
  });

  it('seeds NESTED payload paths (std-booking BookingWizard NEXT: when ?data.providerName)', () => {
    const { pass, fail } = buildGuardPayloads('@payload.data.providerName');
    expect(pass).toEqual({ data: { providerName: 'mock-test-value' } });
    expect(fail).toEqual({ data: { providerName: null } });
  });

  it('deep-merges sibling nested fields in AND guards (wizard step3)', () => {
    const { pass } = buildGuardPayloads([
      'and',
      '@payload.data.customerName',
      '@payload.data.email',
      '@payload.data.phone',
    ]);
    expect(pass).toEqual({
      data: { customerName: 'mock-test-value', email: 'mock-test-value', phone: 'mock-test-value' },
    });
  });

  it('nests comparison operators on dotted paths', () => {
    const { pass, fail } = buildGuardPayloads(['eq', '@payload.data.status', 'ready']);
    expect(pass).toEqual({ data: { status: 'ready' } });
    expect(fail).toEqual({ data: { status: 'not-ready' } });
  });

  it('keeps the row-shaped mock for single-segment existence guards', () => {
    const { pass } = buildGuardPayloads('@payload.row');
    expect(pass.row).toEqual({ id: 'mock-test-id', name: 'mock-test-name' });
  });
});

/**
 * RV-53 — `(> (array/len ?data) 0)` (`DirectMessageStarter.AUTO_OPEN`'s real
 * shape: "does the loaded list have rows"). Before the fix, `>`'s handler
 * called `extractPayloadFieldPath` on the nested `["array/len", ref]` node
 * directly, got `null` (it isn't a bare `@payload.x` string), and fell
 * through to `{pass:{},fail:{}}` — a list-non-empty guard synthesized
 * NOTHING for `data` even on the pass branch, making it false by
 * construction wherever nothing else independently supplied a non-empty
 * array for that field.
 */
describe('buildGuardPayloads — array/len comparisons (RV-53)', () => {
  it('"> 0" (seeded-rows case): pass carries a non-empty array, fail carries an empty one', () => {
    const { pass, fail } = buildGuardPayloads(['>', ['array/len', '@payload.data'], 0]);
    expect(Array.isArray(pass.data)).toBe(true);
    expect((pass.data as unknown[]).length).toBeGreaterThan(0);
    expect(fail.data).toEqual([]);
  });

  it('">= 2": pass has exactly 2 rows, fail clamps below zero to an empty (not negative-length) array', () => {
    const { pass, fail } = buildGuardPayloads(['>=', ['array/len', '@payload.items'], 2]);
    expect(pass.items).toHaveLength(2);
    expect(fail.items).toHaveLength(1);
  });

  it('"< 1" (empty-store case): pass is the empty list itself — the only value satisfying "fewer than one row"', () => {
    const { pass, fail } = buildGuardPayloads(['<', ['array/len', '@payload.data'], 1]);
    expect(pass.data).toEqual([]);
    expect((fail.data as unknown[]).length).toBeGreaterThan(0);
  });

  it('nests array/len paths the same as any other comparison (dotted @payload path)', () => {
    const { pass } = buildGuardPayloads(['>', ['array/len', '@payload.result.rows'], 0]);
    expect(Array.isArray((pass.result as { rows: unknown }).rows)).toBe(true);
  });
});

describe('buildGuardPayloads through str/default', () => {
  const sd = (field: string, dflt: string) => ['str/default', `@payload.${field}`, dflt];

  it('= against the default: pass sends the default, fail anything else', () => {
    expect(buildGuardPayloads(['=', sd('id', ''), ''])).toEqual({ pass: { id: '' }, fail: { id: 'not-' } });
  });

  it('!= against the default: pass sends a value, fail sends the default', () => {
    expect(buildGuardPayloads(['!=', sd('slug', ''), ''])).toEqual({ pass: { slug: 'not-' }, fail: { slug: '' } });
  });

  it('either operand order', () => {
    expect(buildGuardPayloads(['=', '', sd('id', '')])).toEqual({ pass: { id: '' }, fail: { id: 'not-' } });
  });

  it('inside and: the pass payload satisfies both, so a sibling arm keyed on id != "" is not taken', () => {
    const payloads = buildGuardPayloads(['and', ['=', sd('id', ''), ''], ['!=', sd('slug', ''), '']]);
    expect(payloads.pass).toEqual({ id: '', slug: 'not-' });
  });

  it('control: a plain @payload comparison is unchanged', () => {
    expect(buildGuardPayloads(['=', '@payload.kind', 'a'])).toEqual({ pass: { kind: 'a' }, fail: { kind: 'not-a' } });
  });
});

describe('buildGuardPayloads on an array length equality', () => {
  it('= n: pass sends n items, fail n + 1', () => {
    const p = buildGuardPayloads(['=', ['array/len', '@payload.data'], 0]);
    expect(p.pass).toEqual({ data: [] });
    expect(Array.isArray(p.fail['data']) && p.fail['data'].length).toBe(1);
  });

  it('!= n: pass sends n + 1 items, fail n', () => {
    const p = buildGuardPayloads(['!=', ['array/len', '@payload.data'], 2]);
    expect(Array.isArray(p.pass['data']) && p.pass['data'].length).toBe(3);
    expect(Array.isArray(p.fail['data']) && p.fail['data'].length).toBe(2);
  });

  it('control: > on the same length is unchanged', () => {
    const p = buildGuardPayloads(['>', ['array/len', '@payload.data'], 0]);
    expect(Array.isArray(p.pass['data']) && p.pass['data'].length).toBe(1);
  });
});

describe('buildGuardPayloads fail for and', () => {
  it('violates the first sub-guard that can fail, skipping constant-true ones (a folded config knob)', () => {
    const p = buildGuardPayloads(['and', true, ['>', ['array/len', '@payload.data'], 0]]);
    expect(p.fail).toEqual({ data: [] });
  });

  it('control: without a constant, the first sub-guard is violated as before', () => {
    expect(buildGuardPayloads(['and', ['=', '@payload.a', 'x'], ['=', '@payload.b', 'y']]).fail).toEqual({ a: 'not-x' });
  });
});
