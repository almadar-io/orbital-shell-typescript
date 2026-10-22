/**
 * An entity rename reaches an orbital IMPORT (`orbital ShopPage = Catalog.orbitals.X { entity Product }`):
 * the import names its entity in `reference.entity`, not an inline declaration, so a rename that only
 * rewrites inline entities is a silent no-op and the built app keeps the old name.
 */
import { describe, expect, it } from 'vitest';
import { applyDeclarationEntityRename, declaredEntityName } from '../src/factory-runtime/index.js';
import type { OrbitalDefinition, OrbitalSchema } from '../src/types/index.js';

const importOrbital = (entity?: string): OrbitalDefinition => ({
  name: 'ShopPage',
  entity: 'Catalog.orbitals.ShopCatalogOrbital.entity',
  uses: [{ as: 'Catalog', from: 'almadar-behaviors/std-shop-catalog' }],
  reference: { ref: 'Catalog.orbitals.ShopCatalogOrbital', ...(entity !== undefined ? { entity } : {}) },
  traits: [{ ref: 'AppShell.traits.AppLayout', name: 'ShopShell', linkedEntity: 'Product' }],
  pages: [],
});
const schemaOf = (o: OrbitalDefinition): OrbitalSchema => ({ name: 'shop', orbitals: [o] });
const AT = '2026-10-06T00:00:00Z';

describe('declaredEntityName', () => {
  it('reads an inline entity declaration', () => {
    expect(declaredEntityName({ name: 'P', entity: { name: 'Product', fields: [] }, traits: [], pages: [] })).toBe('Product');
  });

  it("reads an import's reference.entity", () => {
    expect(declaredEntityName(importOrbital('Product'))).toBe('Product');
  });

  it('control: an import that does not name its entity has no declared name', () => {
    expect(declaredEntityName(importOrbital())).toBeNull();
  });
});

describe('applyDeclarationEntityRename on an orbital import', () => {
  it("renames the import's reference.entity and its body traits' linkedEntity", () => {
    const out = applyDeclarationEntityRename(schemaOf(importOrbital('Product')), { from: 'Product', to: 'Item' }, AT);
    const o = out.orbitals[0];
    expect(o.reference?.entity).toBe('Item');
    expect(o.traits[0]).toMatchObject({ linkedEntity: 'Item' });
    expect(o.entity).toBe('Catalog.orbitals.ShopCatalogOrbital.entity');
  });

  it('control: an import naming another entity is untouched', () => {
    const schema = schemaOf(importOrbital('CartItem'));
    expect(applyDeclarationEntityRename(schema, { from: 'Product', to: 'Item' }, AT).orbitals[0]).toEqual(schema.orbitals[0]);
  });

  it('control: an import that does not name its entity is untouched', () => {
    const schema = schemaOf(importOrbital());
    expect(applyDeclarationEntityRename(schema, { from: 'Product', to: 'Item' }, AT).orbitals[0]).toEqual(schema.orbitals[0]);
  });
});
