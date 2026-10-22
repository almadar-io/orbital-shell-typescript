/**
 * Coverage for `object/has` / `object/get` / `array/includes` /
 * `str/startsWith` synthesis in `buildGuardPayloads`.
 *
 * `object/has` was the root cause of the vim-mode / std-modal-editor
 * OPERATOR_PENDING verify gap: `["object/has", "@config.operators",
 * "@payload.key"]` (post config-inline, arg[0] is a literal map — see
 * `packages/almadar-std/behaviors/registry/ui/core/atoms/std-modal-editor.orb`)
 * had no case here, so it fell to `{pass:{}, fail:{}}`. That made
 * `guardParity` see a predicted-pass dispatch the runtime correctly
 * rejected (empty payload never satisfies `object/has`), and made
 * `OPERATOR_PENDING` unreachable as a `planReplayTo` precondition since
 * its only guarded inbound edge could never be synthesized as passing.
 */

import { describe, it, expect } from 'vitest';
import { buildGuardPayloads, unhandledGuardOperators } from '../src/state-machine/guard-payloads.js';

describe('buildGuardPayloads — object/has', () => {
  it('passes with the map\'s first key, fails with a key absent from the map', () => {
    const { pass, fail } = buildGuardPayloads([
      'object/has',
      { c: 'change', d: 'delete', y: 'yank' },
      '@payload.key',
    ]);
    expect(pass).toEqual({ key: 'c' });
    expect(fail.key).not.toBe('c');
    expect(fail.key).not.toBe('d');
    expect(fail.key).not.toBe('y');
    expect(typeof fail.key).toBe('string');
  });

  it('handles the map and the payload ref in EITHER argument order', () => {
    const forward = buildGuardPayloads(['object/has', { a: 1 }, '@payload.key']);
    const reversed = buildGuardPayloads(['object/has', '@payload.key', { a: 1 }]);
    expect(forward.pass).toEqual({ key: 'a' });
    expect(reversed.pass).toEqual({ key: 'a' });
  });

  it('seeds a nested payload path', () => {
    const { pass } = buildGuardPayloads(['object/has', { x: 1 }, '@payload.data.key']);
    expect(pass).toEqual({ data: { key: 'x' } });
  });

  it('falls back to empty payloads (no warning) when neither arg is a @payload ref — an @entity-scoped object/has guard', () => {
    const before = unhandledGuardOperators.length;
    const { pass, fail } = buildGuardPayloads(['object/has', '@config.exCommands', '@entity.cmdline']);
    expect(pass).toEqual({});
    expect(fail).toEqual({});
    expect(unhandledGuardOperators.length).toBe(before); // recognized operator, not a fallthrough
  });
});

describe('buildGuardPayloads — object/get (bare truthy guard)', () => {
  it('passes with a key whose value is truthy, fails with an absent key', () => {
    const { pass, fail } = buildGuardPayloads([
      'object/get',
      { a: 'INSERT', b: 'APPEND' },
      '@payload.key',
    ]);
    expect(pass).toEqual({ key: 'a' });
    expect(fail.key).not.toBe('a');
    expect(fail.key).not.toBe('b');
  });

  it('skips a key mapped to a falsy value when picking the pass key', () => {
    const { pass } = buildGuardPayloads(['object/get', { a: false, b: 'ok' }, '@payload.key']);
    expect(pass).toEqual({ key: 'b' });
  });
});

describe('buildGuardPayloads — array/includes', () => {
  it('passes with the first element, fails with a value not in the list', () => {
    const { pass, fail } = buildGuardPayloads(['array/includes', ['a', 'b', 'c'], '@payload.tag']);
    expect(pass).toEqual({ tag: 'a' });
    expect(fail.tag).not.toBe('a');
    expect(fail.tag).not.toBe('b');
    expect(fail.tag).not.toBe('c');
  });

  it('handles the list and the payload ref in EITHER argument order', () => {
    const reversed = buildGuardPayloads(['array/includes', '@payload.tag', ['x', 'y']]);
    expect(reversed.pass).toEqual({ tag: 'x' });
  });
});

describe('buildGuardPayloads — str/startsWith', () => {
  it('passes with a value carrying the prefix, fails with a value that does not', () => {
    const { pass, fail } = buildGuardPayloads(['str/startsWith', '@payload.id', 'sine-']);
    expect(String(pass.id)).toMatch(/^sine-/);
    expect(String(fail.id)).not.toMatch(/^sine-/);
  });
});

describe('buildGuardPayloads — object/get equality comparison (either operand order)', () => {
  const KEY_MAP = { d: 'delete', y: 'yank', c: 'change', '>': 'indent', '<': 'dedent' };

  it('passes with the first key whose mapped value equals the literal', () => {
    const { pass } = buildGuardPayloads(['=', ['object/get', KEY_MAP, '@payload.key'], 'change']);
    expect(pass).toEqual({ key: 'c' });
  });

  it('resolves the object/get operand regardless of comparison side', () => {
    const { pass } = buildGuardPayloads(['=', 'change', ['object/get', KEY_MAP, '@payload.key']]);
    expect(pass).toEqual({ key: 'c' });
  });

  it('leaves the field unbound when no key maps to the literal', () => {
    const { pass } = buildGuardPayloads(['=', ['object/get', KEY_MAP, '@payload.key'], 'zzz']);
    expect(pass).toEqual({});
  });

  it('!= swaps pass/fail roles', () => {
    const { pass } = buildGuardPayloads(['!=', ['object/get', KEY_MAP, '@payload.key'], 'change']);
    expect(Object.keys(KEY_MAP)).toContain(pass.key);
    expect(pass.key).not.toBe('c');
  });
});

describe('buildGuardPayloads — and-conjunct field-candidate intersection', () => {
  const KEY_MAP = { d: 'delete', y: 'yank', c: 'change', '>': 'indent', '<': 'dedent' };

  it('reconciles object/has (any key) with an object/get equality refinement (same field)', () => {
    const { pass } = buildGuardPayloads([
      'and',
      ['object/has', KEY_MAP, '@payload.key'],
      ['=', ['object/get', KEY_MAP, '@payload.key'], 'change'],
    ]);
    expect(pass).toEqual({ key: 'c' });
  });

  it('the sibling != guard picks a key other than "c"', () => {
    const { pass } = buildGuardPayloads([
      'and',
      ['object/has', KEY_MAP, '@payload.key'],
      ['!=', ['object/get', KEY_MAP, '@payload.key'], 'change'],
    ]);
    expect(Object.keys(KEY_MAP)).toContain(pass.key);
    expect(pass.key).not.toBe('c');
  });

  it('reconciles object/has with a bare-field equality literal (same field)', () => {
    const { pass } = buildGuardPayloads([
      'and',
      ['object/has', KEY_MAP, '@payload.key'],
      ['=', '@payload.key', 'y'],
    ]);
    expect(pass).toEqual({ key: 'y' });
  });

  it('is order-independent — the refining conjunct first still wins', () => {
    const { pass } = buildGuardPayloads([
      'and',
      ['=', ['object/get', KEY_MAP, '@payload.key'], 'change'],
      ['object/has', KEY_MAP, '@payload.key'],
    ]);
    expect(pass).toEqual({ key: 'c' });
  });
});

describe('buildGuardPayloads — unrecognized operator is loud, not silent', () => {
  it('records a genuinely unknown operator exactly once', () => {
    const before = unhandledGuardOperators.length;
    buildGuardPayloads(['totally/unknown-op', '@payload.x']);
    buildGuardPayloads(['totally/unknown-op', '@payload.y']);
    expect(unhandledGuardOperators.filter((op) => op === 'totally/unknown-op').length).toBe(1);
    expect(unhandledGuardOperators.length).toBe(before + 1);
  });
});
