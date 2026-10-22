/**
 * Rabit V4 Phase 4 — zod activation gate.
 *
 * The `.orb` zod schemas strip unknown keys by default, so before this phase
 * an id-carrying `.orb` loaded through `OrbitalSchemaSchema` silently lost
 * every dual-carry id field, its `ledger`, and `schemaVersion`. These tests
 * pin that the extended schemas now (a) preserve every id-carrying field a
 * V4 `.orb` declares and (b) reject a prefix-mismatched id.
 */
import { describe, it, expect } from 'vitest';
import {
  OrbitalSchemaSchema,
  parseOrbitalSchema,
  TraitSchema,
  TraitReferenceSchema,
  TraitEventListenerSchema,
  TraitEventContractSchema,
  TraitTickSchema,
  ListenSourceSchema,
  PageTraitRefSchema,
  OrbitalPageSchema,
  PageRefObjectSchema,
} from '../src/types/index';

const ORB = 'orb_01HAAAAAAAAAAAAAAAAAAAAAAA';
const ENT = 'ent_01HAAAAAAAAAAAAAAAAAAAAAAA';
const TRT = 'trt_01HAAAAAAAAAAAAAAAAAAAAAAA';
const TRT2 = 'trt_01HBBBBBBBBBBBBBBBBBBBBBBB';
const EVT = 'evt_01HAAAAAAAAAAAAAAAAAAAAAAA';
const EVT2 = 'evt_01HBBBBBBBBBBBBBBBBBBBBBBB';
const PAG = 'pag_01HAAAAAAAAAAAAAAAAAAAAAAA';

describe('V4 zod activation — dual-carry id fields survive parse', () => {
  it('TraitSchema preserves id + linkedEntityId', () => {
    const parsed = TraitSchema.parse({
      id: TRT,
      name: 'CartBrowse',
      scope: 'collection',
      linkedEntity: 'Cart',
      linkedEntityId: ENT,
    });
    expect(parsed.id).toBe(TRT);
    expect(parsed.linkedEntityId).toBe(ENT);
  });

  it('TraitTickSchema preserves emitIds + pageIds', () => {
    const parsed = TraitTickSchema.parse({
      name: 'tick',
      interval: 'frame',
      effects: [['noop']],
      emits: ['MOVED'],
      emitIds: [EVT],
      pages: ['Board'],
      pageIds: [PAG],
    });
    expect(parsed.emitIds).toEqual([EVT]);
    expect(parsed.pageIds).toEqual([PAG]);
  });

  it('TraitEventContractSchema preserves eventId', () => {
    const parsed = TraitEventContractSchema.parse({ event: 'MOVED', eventId: EVT });
    expect(parsed.eventId).toBe(EVT);
  });

  it('TraitEventListenerSchema preserves eventId + triggersId', () => {
    const parsed = TraitEventListenerSchema.parse({
      event: 'MOVED',
      eventId: EVT,
      triggers: 'RENDER',
      triggersId: EVT2,
    });
    expect(parsed.eventId).toBe(EVT);
    expect(parsed.triggersId).toBe(EVT2);
  });

  it('ListenSourceSchema preserves traitId / orbitalId on both scoped variants', () => {
    const traitScoped = ListenSourceSchema.parse({ kind: 'trait', trait: 'A', traitId: TRT });
    const orbScoped = ListenSourceSchema.parse({
      kind: 'orbital',
      orbital: 'O',
      trait: 'A',
      orbitalId: ORB,
      traitId: TRT,
    });
    expect(traitScoped).toMatchObject({ traitId: TRT });
    expect(orbScoped).toMatchObject({ orbitalId: ORB, traitId: TRT });
  });

  it('TraitReferenceSchema preserves refId + linkedEntityId + eventIds', () => {
    const parsed = TraitReferenceSchema.parse({
      ref: 'Std.traits.Browse',
      refId: TRT,
      linkedEntity: 'Cart',
      linkedEntityId: ENT,
      events: { OPEN: 'ADD_ITEM' },
      eventIds: { OPEN: EVT },
    });
    expect(parsed.refId).toBe(TRT);
    expect(parsed.linkedEntityId).toBe(ENT);
    expect(parsed.eventIds).toEqual({ OPEN: EVT });
  });

  it('PageTraitRefSchema preserves refId + linkedEntityId', () => {
    const parsed = PageTraitRefSchema.parse({ ref: 'Browse', refId: TRT, linkedEntityId: ENT });
    expect(parsed.refId).toBe(TRT);
    expect(parsed.linkedEntityId).toBe(ENT);
  });

  it('OrbitalPageSchema (strict) accepts + preserves id', () => {
    const parsed = OrbitalPageSchema.parse({ id: PAG, name: 'Board', path: '/board' });
    expect(parsed.id).toBe(PAG);
  });

  it('PageRefObjectSchema preserves refId + linkedEntityId + traitRefIds', () => {
    const parsed = PageRefObjectSchema.parse({
      ref: 'Std.pages.Board',
      refId: PAG,
      linkedEntityId: ENT,
      traitRefIds: [TRT, TRT2],
    });
    expect(parsed.refId).toBe(PAG);
    expect(parsed.traitRefIds).toEqual([TRT, TRT2]);
  });

  it('rejects a prefix-mismatched id', () => {
    const bad = TraitSchema.safeParse({ id: ENT, name: 'X', scope: 'instance' });
    expect(bad.success).toBe(false);
  });
});

describe('V4 zod activation — full id-carrying .orb round-trips through the loader schema', () => {
  const idCarryingOrb = {
    name: 'CartApp',
    schemaVersion: 4,
    ledger: {
      schemaVersion: 1 as const,
      entries: {
        [ORB]: { id: ORB, kind: 'orbital', bakedName: 'Cart', curName: 'Cart', renames: [], owner: 'workspace' },
        [ENT]: { id: ENT, kind: 'entity', bakedName: 'Cart', curName: 'Cart', renames: [], owner: 'workspace' },
        [TRT]: { id: TRT, kind: 'trait', bakedName: 'CartBrowse', curName: 'CartBrowse', renames: [], owner: 'workspace' },
        [EVT]: { id: EVT, kind: 'event', bakedName: 'ADD_ITEM', curName: 'ADD_ITEM', renames: [], owner: 'workspace', parent: TRT },
        [PAG]: { id: PAG, kind: 'page', bakedName: 'Board', curName: 'Board', renames: [], owner: 'workspace' },
      },
    },
    designTokens: undefined,
    orbitals: [
      {
        id: ORB,
        name: 'Cart',
        entity: {
          name: 'Cart',
          persistence: 'runtime',
          fields: [{ name: 'id', type: 'string' }],
        },
        traits: [
          {
            id: TRT,
            name: 'CartBrowse',
            scope: 'collection',
            linkedEntity: 'Cart',
            linkedEntityId: ENT,
            stateMachine: {
              states: [{ name: 'browsing', isInitial: true }],
              events: [{ key: 'ADD_ITEM', name: 'Add item' }],
              transitions: [{ from: 'browsing', to: 'browsing', event: 'ADD_ITEM' }],
            },
            emits: [{ event: 'ADD_ITEM', eventId: EVT }],
          },
        ],
        pages: [
          {
            id: PAG,
            name: 'Board',
            path: '/board',
            primaryEntity: 'Cart',
            traits: [{ ref: 'CartBrowse', refId: TRT, linkedEntityId: ENT }],
          },
        ],
      },
    ],
  };

  it('safeParse succeeds and keeps ledger + schemaVersion + node ids', () => {
    const result = OrbitalSchemaSchema.safeParse(idCarryingOrb);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const schema = result.data;
    expect(schema.schemaVersion).toBe(4);
    expect(schema.ledger?.entries[TRT]?.curName).toBe('CartBrowse');
    const orbital = schema.orbitals[0];
    expect(orbital.id).toBe(ORB);
    const trait = orbital.traits[0];
    if (typeof trait === 'string' || 'ref' in trait || !('id' in trait)) throw new Error('expected inline trait with id');
    expect(trait.id).toBe(TRT);
    expect(trait.linkedEntityId).toBe(ENT);
    expect(trait.emits?.[0]?.eventId).toBe(EVT);
  });

  it('parseOrbitalSchema is byte-stable on a legacy id-free .orb (no behavior change)', () => {
    const legacy = { ...idCarryingOrb };
    delete (legacy as { schemaVersion?: number }).schemaVersion;
    delete (legacy as { ledger?: unknown }).ledger;
    const parsed = parseOrbitalSchema(legacy);
    expect(parsed.schemaVersion).toBeUndefined();
    expect(parsed.ledger).toBeUndefined();
    expect(parsed.orbitals[0].name).toBe('Cart');
  });
});
