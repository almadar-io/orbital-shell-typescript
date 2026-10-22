import { describe, it, expect } from 'vitest';
import { EntityFieldSchema, FIELD_TYPES } from '../src/types/field';
import { TRAIT_FIELD_TYPES } from '../src/types/trait';

// G-ORB-093 mirror: `.orb` JSON carries `"type": "SExpr"` for an SExpr-typed
// struct member (a transition's guard / effect args), as orbital-core emits it.
describe('sexpr field type', () => {
  it('is a declared field type and trait field type', () => {
    expect(FIELD_TYPES).toContain('SExpr');
    expect(TRAIT_FIELD_TYPES).toContain('SExpr');
  });

  it('parses a field definition typed sexpr', () => {
    expect(EntityFieldSchema.safeParse({ name: 'guard', type: 'SExpr' }).success).toBe(true);
  });

  it('control: an unknown type is still rejected', () => {
    expect(EntityFieldSchema.safeParse({ name: 'guard', type: 'SExprr' }).success).toBe(false);
  });
});
