/**
 * `dependencyGraphOf` — an app's dependency graph from what its `.orb`s record:
 * each orbital's direct imports, then every reached behavior's own imports from
 * its registry `.orb`, each placed in its layer (io, std, a std UI primitive —
 * a registry `pattern` factory — or unknown).
 */
import { describe, expect, it } from 'vitest';
import { DependencyGraphSchema, dependencyGraphOf, importsOf } from '../index';
import type { BehaviorTier, OrbitalSchema } from '../index';

const orbital = (name: string, uses: Array<[string, string]>): OrbitalSchema['orbitals'][number] => ({
  name,
  entity: { name: `${name}Row`, fields: [] },
  uses: uses.map(([as, from]) => ({ as, from })),
  traits: [],
  pages: [],
});
const app: OrbitalSchema = {
  name: 'App',
  orbitals: [
    orbital('Patient', [['Browse', 'std/behaviors/std-browse'], ['Crm', 'almadar-behaviors/std-crm']]),
    orbital('Person', [['Browse', 'std/behaviors/std-browse'], ['Ghost', 'std/behaviors/std-missing']]),
  ],
};
const golden: Record<string, OrbitalSchema> = {
  'std-browse': { name: 'std-browse', orbitals: [orbital('B', [['List', 'std/behaviors/ui-data-list']])] },
  'std-crm': { name: 'std-crm', orbitals: [orbital('C', [['Browse', 'std/behaviors/std-browse'], ['Loop', 'almadar-behaviors/std-crm']])] },
  'ui-data-list': { name: 'ui-data-list', orbitals: [orbital('L', [])] },
};
const TIERS: Record<string, BehaviorTier> = { 'std-browse': 'std', 'ui-data-list': 'std', 'std-crm': 'io' };
const deps = {
  tierOf: (n: string): BehaviorTier => TIERS[n] ?? 'unknown',
  orbOf: (n: string): OrbitalSchema | null => golden[n] ?? null,
  patternOf: (n: string): string | undefined => (n === 'ui-data-list' ? 'data-list' : undefined),
};

describe('dependencyGraphOf', () => {
  const g = dependencyGraphOf(app, deps);

  it("lists each orbital's direct imports", () => {
    expect(g.orbitals).toEqual({ Patient: ['std-browse', 'std-crm'], Person: ['std-browse', 'std-missing'] });
  });

  it('follows every reached behavior to its own imports, once each, through a cycle', () => {
    expect(g.behaviors['std-crm'].imports).toEqual(['std-browse', 'std-crm']);
    expect(g.behaviors['std-browse'].imports).toEqual(['ui-data-list']);
    expect(Object.keys(g.behaviors).sort()).toEqual(['std-browse', 'std-crm', 'std-missing', 'ui-data-list']);
  });

  it('places each behavior in its declared layer; a pattern factory is a UI primitive', () => {
    expect(Object.fromEntries(Object.entries(g.behaviors).map(([n, b]) => [n, b.layer]))).toEqual({
      'std-browse': 'std',
      'std-crm': 'io',
      'std-missing': 'unknown',
      'ui-data-list': 'primitive',
    });
  });

  it('control: a behavior with no registry .orb imports nothing', () => {
    expect(g.behaviors['std-missing'].imports).toEqual([]);
  });
});

describe('importsOf', () => {
  it("resolves each use to its behavior by the path's trailing name, with the traits composed from it", () => {
    const schema: OrbitalSchema = {
      name: 'App',
      orbitals: [{ name: 'Shop', entity: { name: 'Item', fields: [] }, uses: [{ as: 'Browse', from: 'std/behaviors/std-browse' }], traits: [{ ref: 'Browse.traits.List', name: 'ShopList' }], pages: [] }],
    };
    expect(importsOf(schema, () => 'std')).toEqual([
      { as: 'Browse', from: 'std/behaviors/std-browse', behavior: 'std-browse', tier: 'std', traits: [{ name: 'ShopList', ref: 'Browse.traits.List' }] },
    ]);
  });

  it('control: own traits are not imports', () => {
    const schema: OrbitalSchema = { name: 'App', orbitals: [{ name: 'Shop', entity: { name: 'Item', fields: [] }, traits: [], pages: [] }] };
    expect(importsOf(schema, () => 'std')).toEqual([]);
  });
});

describe('DependencyGraphSchema — the graph as a host serves it', () => {
  it('reads back a graph a host built', () => {
    const graph = { orbitals: { Shop: ['std-browse'] }, behaviors: { 'std-browse': { layer: 'std', imports: ['ui-list'] }, 'ui-list': { layer: 'primitive', imports: [] } } };
    expect(DependencyGraphSchema.parse(graph)).toEqual(graph);
  });

  it('control: an unknown layer is refused', () => {
    expect(DependencyGraphSchema.safeParse({ orbitals: {}, behaviors: { x: { layer: 'app', imports: [] } } }).success).toBe(false);
  });
});
