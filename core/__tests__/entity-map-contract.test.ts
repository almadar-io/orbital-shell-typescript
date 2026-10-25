import { describe, expect, it } from 'vitest';
import { schemaToIR } from '../src/resolver.js';
import { EntityFieldSchema, type EntityField } from '../src/types/field.js';
import { createResolvedField } from '../src/types/ir.js';
import type { OrbitalSchema } from '../src/types/schema.js';
import { ownerFieldsFromSchema } from '../src/mock/identityOwners.js';

const embeddedAsset: EntityField = {
  type: 'relation', intrinsic: true, relation: { entity: 'Asset', cardinality: 'one' },
};
const assets: EntityField & { name: string } = {
  name: 'assetByKey', type: 'object', required: true, items: embeddedAsset,
  default: { hero: { id: 'asset-1', url: '/hero.png' } },
};
const schema: OrbitalSchema = {
  name: 'AssetBoard', version: '1.0.0', orbitals: [{
    name: 'Board', entity: { name: 'Board', fields: [assets, {
      name: 'owner', type: 'relation', relation: { entity: 'Asset', cardinality: 'one' },
    }] }, auxiliaryEntities: [{ name: 'Asset', identity: true, fields: [] }], traits: [], pages: [],
  }],
};

describe('embedded entity map contract', () => {
  it('preserves the lowered row descriptor when parsing a map', () => {
    expect(EntityFieldSchema.parse(assets)).toEqual(assets);
  });

  it('control: a map relation value still requires its target binding', () => {
    expect(EntityFieldSchema.safeParse({ type: 'object', items: { type: 'relation', intrinsic: true } }).success).toBe(false);
  });

  it('carries the map descriptor through schema resolution', () => {
    expect(schemaToIR(schema).entities.get('Board')?.fields[0]).toMatchObject({
      items: embeddedAsset, default: assets.default,
    });
  });

  it('carries intrinsic rows and nested record descriptors through resolved-field creation', () => {
    const field = EntityFieldSchema.parse({
      name: 'asset', ...embeddedAsset, properties: { url: { type: 'string' } },
    });
    expect(createResolvedField({ ...field, name: 'asset' })).toMatchObject({
      intrinsic: true, relation: embeddedAsset.relation, properties: { url: { type: 'string' } },
    });
  });

  it('classifies only the direct foreign key as an owner column', () => {
    expect(ownerFieldsFromSchema(schema)).toEqual(['Board.owner']);
  });
});
