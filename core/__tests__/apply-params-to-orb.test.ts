import { describe, it, expect } from 'vitest';
import { mergeCallSiteConfigOverrides } from '../src/factory-runtime/apply-params-to-orb.js';
import { isCallSiteConfigDeclaration, asEntityId } from '../src/types/index.js';
import type { OrbitalSchema } from '../src/types/index.js';

// RABIT-BUG-2 — trait-slot objectification. A trait-typed config slot
// (e.g. `toolbar1Trait`) must always resolve to a plain `@trait.<Name>`
// string default, never the annotated `{ type, default }` declaration
// object itself. Reported symptom: `orb validate` rejecting factory
// candidates with `ORB_T_CONFIG_SHAPE_MISMATCH: expected string, got
// object` / `ORB_BINDING_TRAIT_INVALID_FORMAT` on std-embedded-dashboard's
// DashboardOrbital, dispatched with empty params (`{}`). Root-caused to an
// orbital-rust inline-fold bug (fixed by `dbd419e fix(inline): defer
// @config fold on import-load so consumer overrides reach guards`) — this
// pins the JS-side merge (the layer this bug's fix was suspected to live
// in) so a future regression here is caught without needing the Rust
// resolve+validate round trip.
describe('mergeCallSiteConfigOverrides — no double-wrapping', () => {
  it('never double-wraps a declared base entry when the override is a plain string (trait-typed slot)', () => {
    const base = { toolbar1Trait: { type: 'unknown', default: '@trait.InlineExportMenu1' } };
    const overrides = { toolbar1Trait: '@trait.InlineDateRangeFilter2' };
    const merged = mergeCallSiteConfigOverrides(base, overrides);

    expect(isCallSiteConfigDeclaration(merged['toolbar1Trait']!)).toBe(true);
    const entry = merged['toolbar1Trait'] as { type: string; default: unknown };
    expect(typeof entry.default).toBe('string');
    expect(entry.default).toBe('@trait.InlineDateRangeFilter2');
  });

  it('never double-wraps a declared base entry when the override is a plain scalar', () => {
    const base = { period: { type: 'unknown', default: 'quarter' } };
    const overrides = { period: 'month' };
    const merged = mergeCallSiteConfigOverrides(base, overrides);

    const entry = merged['period'] as { type: string; default: unknown };
    expect(typeof entry.default).toBe('string');
    expect(entry.default).toBe('month');
  });

  it('leaves fields absent from overrides exactly as declared on the base', () => {
    const base = { showLegend: { type: 'unknown', default: false } };
    const merged = mergeCallSiteConfigOverrides(base, {});

    expect(merged['showLegend']).toEqual({ type: 'unknown', default: false });
  });

  it('wraps a plain-value base entry (no prior declaration) into a fresh unknown-typed declaration', () => {
    const base = { minTileWidth: 320 };
    const overrides = { minTileWidth: 400 };
    const merged = mergeCallSiteConfigOverrides(base, overrides);

    expect(merged['minTileWidth']).toEqual({ type: 'unknown', default: 400 });
  });

  it('an override that is itself a full declaration replaces the base outright (not nested under it)', () => {
    const base = { title: { type: 'unknown', default: 'Revenue by Quarter' } };
    const overrides = { title: { type: 'string', default: 'Q Revenue', label: 'Title' } };
    const merged = mergeCallSiteConfigOverrides(base, overrides);

    expect(merged['title']).toEqual({ type: 'string', default: 'Q Revenue', label: 'Title' });
  });
});

// E5a — derived `expects` declarations must survive the L1 params overlay:
// `applyParamsToOrb` rebuilds the orbital through `makeOrbitalWithUses`, and a
// rebuild that drops `expects` would strip the slice's standalone-validation
// contract on every factory dispatch.
describe('applyParamsToOrb — expects preservation', () => {
  it('threads the orbital’s derived expects through the rebuild untouched', async () => {
    const { applyParamsToOrb } = await import('../src/factory-runtime/apply-params-to-orb.js');
    const expects = [
      {
        kind: 'identity' as const,
        name: 'Customer',
        shape: [{ name: 'role', type: 'enum' as const, values: ['customer', 'store-manager'] }],
      },
      { kind: 'entity' as const, name: 'OrderRecord' },
    ];
    const orb = {
      name: 'fixture',
      orbitals: [
        {
          name: 'ProductOrbital',
          entity: { name: 'Product', fields: [{ name: 'id', type: 'string' as const, required: true }] },
          expects,
          traits: [],
          pages: [],
        },
      ],
    };
    const manifest = {
      organism: 'fixture',
      orbitalName: 'ProductOrbital',
      paramFields: [],
      traitNames: [],
      inlineTraitNames: [],
    };
    const built = applyParamsToOrb(orb, 'ProductOrbital', manifest, {});
    expect(built.expects).toEqual(expects);
  });
});

// G-L3-ENTITY-ID-COLLISION (factory-path half) — a corrective re-instantiate
// at the baked entity name applies no rename (from === to), so a stale
// ledger row adopted from the prior `.orb` must be healed to the declaration
// name or the file manufactures ORB_ID_NAME_MISMATCH.
describe('healEntityLedgerRows — factory rebuild ledger agreement', () => {
  const makeSchema = (curName: string): OrbitalSchema => ({
    name: 'fixture',
    orbitals: [
      {
        name: 'MarketplaceUserOrbital',
        entity: {
          id: asEntityId('ent_01TESTHEAL0000000000000'),
          name: 'MarketplaceUser',
          fields: [{ name: 'id', type: 'string' as const, required: true }],
        },
        traits: [],
        pages: [],
      },
    ],
    ledger: {
      schemaVersion: 1 as const,
      entries: {
        ent_01TESTHEAL0000000000000: {
          id: 'ent_01TESTHEAL0000000000000',
          kind: 'entity' as const,
          bakedName: 'MarketplaceUser',
          curName,
          renames: [{ from: 'MarketplaceUser', to: curName, at: '2026-08-06T11:06:10.355Z' }],
          owner: 'workspace' as const,
        },
      },
    },
  });

  it('heals a stale curName back to the declaration name, appending the rename row', async () => {
    const { healEntityLedgerRows } = await import('../src/factory-runtime/apply-params-to-orb.js');
    const healed = healEntityLedgerRows(makeSchema('Product'), '2026-08-06T11:09:26.000Z');
    const entry = healed.ledger!.entries['ent_01TESTHEAL0000000000000']!;
    expect(entry.curName).toBe('MarketplaceUser');
    expect(entry.renames).toHaveLength(2);
    expect(entry.renames[1]).toEqual({
      from: 'Product',
      to: 'MarketplaceUser',
      at: '2026-08-06T11:09:26.000Z',
    });
  });

  it('is a no-op when the row already agrees with the declaration', async () => {
    const { healEntityLedgerRows } = await import('../src/factory-runtime/apply-params-to-orb.js');
    const schema = makeSchema('MarketplaceUser');
    expect(healEntityLedgerRows(schema, '2026-08-06T11:09:26.000Z')).toBe(schema);
  });

  it('leaves non-entity rows and id-less declarations untouched', async () => {
    const { healEntityLedgerRows } = await import('../src/factory-runtime/apply-params-to-orb.js');
    const schema = makeSchema('Product');
    schema.orbitals[0]!.entity = { name: 'MarketplaceUser', fields: [] } as never;
    expect(healEntityLedgerRows(schema, '2026-08-06T11:09:26.000Z')).toBe(schema);
  });
});

// A declaration with no `default` (e.g. `contentTrait : trait`) is still a
// declaration: wrapping it as a bare value put the schema object in `default`,
// which then rendered as a pattern of type "trait" (std-app-layout with ANY
// config override → ORB_RUI_INVALID_PATTERN; G-RABIT-017 builder flow).
describe('mergeCallSiteConfigOverrides — default-less declarations', () => {
  const contentTrait = { type: 'trait', label: 'Content trait', tier: 'presentation' };

  it('keeps a default-less declaration as-is when another field is overridden', () => {
    const merged = mergeCallSiteConfigOverrides({ contentTrait, appName: { type: 'string', default: 'App' } }, { appName: 'Fitness' });
    expect(merged['contentTrait']).toEqual(contentTrait);
    expect(merged['appName']).toEqual({ type: 'string', default: 'Fitness' });
  });

  it('folds an override into a default-less declaration', () => {
    const merged = mergeCallSiteConfigOverrides({ contentTrait }, { contentTrait: '@trait.Board' });
    expect(merged['contentTrait']).toEqual({ ...contentTrait, default: '@trait.Board' });
  });

  it('still wraps a render-value object that only happens to carry a `type` key (control)', () => {
    const tabs = { type: 'tabs', items: [] };
    const merged = mergeCallSiteConfigOverrides({ view: tabs }, {});
    expect(merged['view']).toEqual({ type: 'unknown', default: tabs });
  });
});
