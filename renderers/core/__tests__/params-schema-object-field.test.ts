/**
 * G-CROSS-064 — the factory `fields` surface can declare a nested structure
 * within the entity: an `object` field carries its members in `properties`
 * (a struct) or its value type in `items` (a map). A shapeless `object` is
 * not expressible — `orb validate` rejects it (ORB_T_GENERIC_TYPE_DEPRECATED).
 */
import { describe, expect, it } from 'vitest';
import type { FactorySignature, JsonSchema } from '../index';
import { signatureToParamsSchema } from '../index';

const signature: FactorySignature = {
  organism: 'std-browse',
  orbital: 'BrowseItemOrbital',
  tier: 'atoms',
  factoryPath: 'fake.ts',
  entities: [{ name: 'BrowseItem', fields: [{ name: 'name', type: 'string', required: true }], persistence: 'persistent' }],
  traits: [],
  pages: [{ name: 'BrowseItemPage', defaultPath: '/browseitems', primaryEntity: 'BrowseItem' }],
  emittedEvents: [],
  listenedEvents: [],
};

function fieldBranches(): ReadonlyArray<JsonSchema> {
  const branches = signatureToParamsSchema(signature).properties?.['fields']?.items?.oneOf;
  if (!Array.isArray(branches)) throw new Error('fields.items.oneOf missing');
  return branches;
}

function typeEnum(branch: JsonSchema): ReadonlyArray<string> {
  const e = branch.properties?.['type']?.enum;
  return Array.isArray(e) ? e.filter((v): v is string => typeof v === 'string') : [];
}

const objectBranches = (): ReadonlyArray<JsonSchema> =>
  fieldBranches().filter((b) => typeEnum(b).length === 1 && typeEnum(b)[0] === 'object');

describe('signatureToParamsSchema — object fields (G-CROSS-064)', () => {
  it('no branch admits a shapeless object (object is never a bare scalar)', () => {
    for (const b of fieldBranches()) {
      if (typeEnum(b).length > 1) expect(typeEnum(b)).not.toContain('object');
    }
  });

  it('one object branch requires members or a value type and preserves both', () => {
    expect(objectBranches()).toHaveLength(1);
    const object = objectBranches()[0];
    expect(object?.anyOf).toEqual([{ required: ['properties'] }, { required: ['items'] }]);
    expect(object?.properties?.properties?.type).toBe('object');
    expect(object?.properties?.items).toBeDefined();
    expect(object?.additionalProperties).toBe(false);
  });

  it('control: scalar types are unchanged', () => {
    const scalar = fieldBranches().find((b) => typeEnum(b).includes('string'));
    expect(typeEnum(scalar ?? {})).toEqual(
      expect.arrayContaining(['string', 'number', 'boolean', 'date', 'email', 'url', 'image']),
    );
  });
});
