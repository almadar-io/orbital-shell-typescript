import { describe, it, expect } from 'vitest';
import { EFFECT_OPERATORS, EFFECT_OPERATOR_FAMILIES } from '../src/types/effect.js';

describe('EFFECT_OPERATORS', () => {
  it('lists each literal effect operator once', () => {
    expect(new Set(EFFECT_OPERATORS).size).toBe(EFFECT_OPERATORS.length);
  });

  it('no literal operator is shadowed by a family (control: families are prefixes only)', () => {
    const families = new Set<string>(EFFECT_OPERATOR_FAMILIES);
    expect(EFFECT_OPERATORS.filter((op) => families.has(op.split('/')[0]) && op.includes('/'))).toEqual([]);
  });

  it('declares the std-table effects kv/*, behavior/packages and program/self|tick|resolve-rows', () => {
    const literals = new Set<string>(EFFECT_OPERATORS);
    for (const op of ['behavior/packages', 'program/self', 'program/tick', 'program/resolve-rows']) expect(literals.has(op), op).toBe(true);
    expect((EFFECT_OPERATOR_FAMILIES as readonly string[]).includes('kv')).toBe(true);
    expect(literals.has('kv/get')).toBe(false);
  });
});
