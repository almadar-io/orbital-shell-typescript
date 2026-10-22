import { describe, expect, it } from 'vitest';
import { EntityFieldSchema, FieldTypeSchema, isTypeVariable } from '../src/types/field';

describe('type-variable field type', () => {
  it('accepts `$name` as a field type and keeps the tags', () => {
    expect(FieldTypeSchema.safeParse('$t').success).toBe(true);
    expect(FieldTypeSchema.safeParse('string').success).toBe(true);
    expect(FieldTypeSchema.safeParse('$').success).toBe(false);
    expect(FieldTypeSchema.safeParse('strnig').success).toBe(false);
    expect(isTypeVariable('$t')).toBe(true);
    expect(isTypeVariable('t')).toBe(false);
  });

  it('parses the lowered `Page t` shape, items typed `$t`', () => {
    const page = EntityFieldSchema.safeParse({
      name: 'page',
      type: 'object',
      properties: {
        items: { name: 'items', type: 'array', required: true, items: { type: '$t' } },
        cursor: { name: 'cursor', type: 'string' },
      },
    });
    expect(page.success).toBe(true);
    if (page.success && page.data.type === 'object') {
      const items = page.data.properties?.items;
      expect(items?.type === 'array' ? items.items?.type : undefined).toBe('$t');
    }
    expect(EntityFieldSchema.safeParse({ name: 'x', type: '$' }).success).toBe(false);
  });
});

describe('trait field descriptors carry a type variable', () => {
  it('a config item member typed `$v` parses; a bare `$` does not', async () => {
    const { TraitEntityFieldSchema, RequiredFieldSchema } = await import('../src/types/trait');
    expect(TraitEntityFieldSchema.safeParse({ name: 'value', type: '$v' }).success).toBe(true);
    expect(RequiredFieldSchema.safeParse({ name: 'value', type: '$v' }).success).toBe(true);
    expect(TraitEntityFieldSchema.safeParse({ name: 'value', type: '$' }).success).toBe(false);
  });
});
