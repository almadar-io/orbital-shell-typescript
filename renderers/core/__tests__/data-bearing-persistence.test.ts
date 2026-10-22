import { describe, expect, it } from 'vitest';
import { applyParamsToOrb } from '../src/factory-runtime/apply-params-to-orb.js';
import { parseOrbitalSchema, persistenceModeAllowsOverrides, orbitalTouchesOwnRecord } from '../index';
import type { OrbitalDefinition, SExpr } from '../src/types/index.js';

const orbital = (effects: SExpr[]): OrbitalDefinition => parseOrbitalSchema({
  name: 'fixture',
  version: '1.0.0',
  orbitals: [{
    name: 'RecipeOrbital',
    entity: { name: 'BrowseItem', persistence: 'runtime', fields: [{ name: 'id', type: 'string', required: true }] },
    traits: [{ name: 'Browse', linkedEntity: 'BrowseItem', category: 'interaction', scope: 'instance', stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [{ key: 'INIT', name: 'INIT' }], transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects }] } }],
    pages: [],
  }],
}).orbitals[0]!;

describe('persistenceModeAllowsOverrides — a runtime record a data atom owns (D17)', () => {
  it('persistent and undefined always allow; runtime allows only when the atom is data-bearing', () => {
    expect(persistenceModeAllowsOverrides('persistent')).toBe(true);
    expect(persistenceModeAllowsOverrides(undefined)).toBe(true);
    expect(persistenceModeAllowsOverrides('runtime')).toBe(false);
    expect(persistenceModeAllowsOverrides('runtime', true)).toBe(true);
  });
});

describe('orbitalTouchesOwnRecord', () => {
  it('a fetch or persist of the orbital\'s own record makes it data-bearing', () => {
    expect(orbitalTouchesOwnRecord(orbital([['fetch', 'BrowseItem', {}]]))).toBe(true);
    expect(orbitalTouchesOwnRecord(orbital([['persist', 'create', 'BrowseItem', {}]]))).toBe(true);
  });

  it('control: effects on another record, or no data effects, are not', () => {
    expect(orbitalTouchesOwnRecord(orbital([['fetch', 'Other', {}]]))).toBe(false);
    expect(orbitalTouchesOwnRecord(orbital([['render-ui', 'main', { type: 'stack' }]]))).toBe(false);
  });
});

describe('applyParamsToOrb — a runtime record made persistent (D17)', () => {
  const manifest = { organism: 'fixture', orbitalName: 'RecipeOrbital', paramFields: [], traitNames: [], inlineTraitNames: [] };
  const schema = (effects: SExpr[]) => parseOrbitalSchema({ name: 'fixture', version: '1.0.0', orbitals: [orbital(effects)] });

  it('a data-bearing orbital becomes persistent with a collection derived from the effective name', () => {
    const orb = schema([['fetch', 'BrowseItem', {}]]);
    const built = applyParamsToOrb(orb, 'RecipeOrbital', manifest, { entityName: 'Recipe', persistence: 'persistent' });
    const entity = built.entity;
    expect(typeof entity === 'object' && 'persistence' in entity ? [entity.persistence, entity.collection] : null).toEqual(['persistent', 'recipes']);
  });

  it('control: an explicit collection wins; runtime state nothing fetches stays runtime with no collection', () => {
    const orb = schema([['fetch', 'BrowseItem', {}]]);
    const named = applyParamsToOrb(orb, 'RecipeOrbital', manifest, { persistence: 'persistent', collection: 'cookbook' }).entity;
    expect(typeof named === 'object' && 'collection' in named ? named.collection : null).toBe('cookbook');
    const state = schema([['render-ui', 'main', { type: 'stack' }]]);
    const kept = applyParamsToOrb(state, 'RecipeOrbital', manifest, { persistence: 'persistent' }).entity;
    expect(typeof kept === 'object' && 'persistence' in kept ? [kept.persistence, kept.collection] : null).toEqual(['runtime', undefined]);
  });
});
