import { describe, expect, it } from 'vitest';
import { ENTITY_FIELD_SCHEMA } from '../src/factory/index';
import { EntityFieldSchema } from '../src/types/field';

describe('shared entity field tool contract', () => {
  it('preserves money support when composition reuses the canonical schema', () => {
    const scalar = ENTITY_FIELD_SCHEMA.oneOf?.find(branch => branch.properties?.type?.enum?.includes('string'));
    expect(scalar?.properties?.type?.enum).toContain('money');
  });

  it('requires the declared target for a relation field', () => {
    const relation = ENTITY_FIELD_SCHEMA.oneOf?.find(branch => branch.properties?.type?.enum?.includes('relation'));
    expect(relation?.required).toContain('relation');
    expect(relation?.properties?.relation?.required).toEqual(['entity']);
  });

  it.each([
    { name: 'choice', type: 'union', values: ['Text'], properties: { Text: { type: 'string' } } },
    { name: 'point', type: 'tuple', properties: { '0': { type: 'number' }, '1': { type: 'number' } } },
  ])('carries the canonical $type contract', input => {
    const field = EntityFieldSchema.parse(input);
    const branch = ENTITY_FIELD_SCHEMA.oneOf?.find(candidate => candidate.properties?.type?.enum?.includes(field.type));
    expect(branch).toBeDefined();
    expect(branch?.required).toContain(field.type === 'union' ? 'values' : 'properties');
  });

  it('preserves nameless nested descriptors and object defaults', () => {
    const field = EntityFieldSchema.parse({ name: 'rows', type: 'array', items: { type: 'string' }, default: ['a'] });
    expect(field).toMatchObject({ items: { type: 'string' }, default: ['a'] });
    const array = ENTITY_FIELD_SCHEMA.oneOf?.find(branch => branch.properties?.type?.enum?.includes('array'));
    expect(array?.properties?.default?.type).toEqual(expect.arrayContaining(['array', 'object']));
    expect(array?.properties?.items?.required ?? []).not.toContain('name');
  });

  it.each([
    { name: 'choice', type: 'union' },
    { name: 'point', type: 'tuple' },
    { name: 'owner', type: 'relation' },
    { name: 'choice', type: 'enum' },
  ])('control: canonical $type rejects missing payload', input => {
    expect(EntityFieldSchema.safeParse(input).success).toBe(false);
  });

  it('keeps nested descriptors recursive, relocatable and strict without requiring names', () => {
    expect(ENTITY_FIELD_SCHEMA.$id).toBe('urn:almadar:entity-field');
    const nestedBranches = ENTITY_FIELD_SCHEMA.$defs?.field?.oneOf;
    expect(nestedBranches).toHaveLength(ENTITY_FIELD_SCHEMA.oneOf?.length ?? 0);
    for (const branch of nestedBranches ?? []) {
      expect(branch.required ?? []).not.toContain('name');
      expect(branch.required).toContain('type');
      expect(branch.additionalProperties).toBe(false);
      expect(branch.properties?.properties?.additionalProperties).toEqual({ $ref: 'urn:almadar:entity-field#/$defs/field' });
    }
    for (const branch of ENTITY_FIELD_SCHEMA.oneOf ?? []) {
      expect(branch.required).toContain('name');
      if (branch.properties?.items) expect(branch.properties.items.$ref).toBe('urn:almadar:entity-field#/$defs/field');
    }
    expect(() => JSON.stringify(ENTITY_FIELD_SCHEMA)).not.toThrow();
  });

  it.each(['enum', 'union'])('rejects an empty %s vocabulary in both contracts', type => {
    expect(EntityFieldSchema.safeParse({ name: 'choice', type, values: [] }).success).toBe(false);
    expect(EntityFieldSchema.safeParse({ name: 'choice', type, values: ['A'] }).success).toBe(true);
    for (const branches of [ENTITY_FIELD_SCHEMA.oneOf, ENTITY_FIELD_SCHEMA.$defs?.field?.oneOf]) {
      const branch = branches?.find(candidate => candidate.properties?.type?.enum?.includes(type));
      expect(branch?.properties?.values?.minItems).toBe(1);
    }
  });

  it('rejects an empty tuple while preserving array defaults and scalar hints', () => {
    expect(EntityFieldSchema.safeParse({ name: 'point', type: 'tuple', properties: {} }).success).toBe(false);
    expect(EntityFieldSchema.safeParse({ name: 'point', type: 'tuple', properties: { '0': { type: 'number' } } }).success).toBe(true);
    for (const branches of [ENTITY_FIELD_SCHEMA.oneOf, ENTITY_FIELD_SCHEMA.$defs?.field?.oneOf]) {
      const tuple = branches?.find(branch => branch.properties?.type?.enum?.includes('tuple'));
      expect(tuple?.properties?.properties?.minProperties).toBe(1);
      const scalar = branches?.find(branch => branch.properties?.type?.enum?.includes('string'));
      expect(scalar?.properties?.values?.minItems).toBeUndefined();
      const array = branches?.find(branch => branch.properties?.type?.enum?.includes('array'));
      expect(array?.properties?.default?.minItems).toBeUndefined();
    }
    expect(EntityFieldSchema.safeParse({ name: 'hint', type: 'string', values: [] }).success).toBe(true);
    expect(EntityFieldSchema.safeParse({ name: 'rows', type: 'array', default: [] }).success).toBe(true);
  });

  it('control: enums cannot omit their declared vocabulary', () => {
    const enumeration = ENTITY_FIELD_SCHEMA.oneOf?.find(branch => branch.properties?.type?.enum?.includes('enum'));
    expect(enumeration?.required).toContain('values');
  });

  it('retains metadata accepted by the canonical scalar field contract', () => {
    const field = EntityFieldSchema.parse({
      name: 'role', type: 'string', values: ['member'], default: 'member',
      description: 'Workspace role', synonyms: 'permission', intrinsic: true,
      primaryKey: false, min: 1, max: 10, mock: 'role', mergedFrom: 'Account.role',
    });
    const scalar = ENTITY_FIELD_SCHEMA.oneOf?.find(branch => branch.properties?.type?.enum?.includes(field.type));
    for (const key of Object.keys(field)) expect(scalar?.properties, key).toHaveProperty(key);
  });

  it('retains normalized relation metadata', () => {
    const field = EntityFieldSchema.parse({ name: 'owner', type: 'relation', relation: { entity: 'Member', cardinality: 'one', field: 'id', onDelete: 'restrict' } });
    const relation = ENTITY_FIELD_SCHEMA.oneOf?.find(branch => branch.properties?.type?.enum?.includes(field.type));
    for (const key of ['field', 'onDelete']) expect(relation?.properties?.relation?.properties, key).toHaveProperty(key);
  });

  it('rejects the removed catch-all type scalar', () => {
    expect(() => EntityFieldSchema.parse({ name: 'value', type: 'scalar' })).toThrow();
  });

  it.each(['file', 'trait', 'slot', 'pattern', 'node', 'event', 'EventAddress', 'CallKey', 'SExpr'])('carries an existing scalar tag: %s', type => {
    const field = EntityFieldSchema.parse({ name: 'value', type });
    expect(ENTITY_FIELD_SCHEMA.oneOf?.some(branch => branch.properties?.type?.enum?.includes(field.type))).toBe(true);
  });
});
