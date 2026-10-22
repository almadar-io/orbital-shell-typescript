/**
 * `.lolo` `[T1, T2, …]` lowers to a `tuple` field whose slots ride `properties`, keyed
 * by slot index — the Rust `FieldType::Tuple` contract. The runtime path parses the same
 * `.orb`, so the TS mirror must accept it.
 */
import { describe, expect, it } from 'vitest';
import { EntityFieldSchema, FIELD_TYPES, type EntityField } from '../src/types/field.js';
import { TRAIT_FIELD_TYPES } from '../src/types/trait.js';

describe('tuple field type', () => {
  it('is a field type on both mirrors', () => {
    expect(FIELD_TYPES).toContain('tuple');
    expect(TRAIT_FIELD_TYPES).toContain('tuple');
  });

  it('parses a tuple field with index-keyed slots', () => {
    const field: EntityField = {
      name: 'position',
      type: 'tuple',
      properties: { '0': { type: 'number' }, '1': { type: 'number' }, '2': { type: 'number' } },
    };
    expect(EntityFieldSchema.safeParse(field).success).toBe(true);
  });

  it('control: a tuple with no slots is refused', () => {
    expect(EntityFieldSchema.safeParse({ name: 'p', type: 'tuple' }).success).toBe(false);
  });
});
