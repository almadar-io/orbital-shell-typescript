import { describe, it, expect } from 'vitest';
import {
  mintId,
  isOrbitalId,
  asOrbitalId,
  isEntityId,
  asEntityId,
  isTraitId,
  asTraitId,
  isEventId,
  asEventId,
  isPageId,
  asPageId,
  isServiceId,
  asServiceId,
  isThemeId,
  asThemeId,
  isPaletteEntryId,
  asPaletteEntryId,
  ledgerResolveName,
  ledgerRename,
  ledgerCurName,
  type IdKind,
  type IdentityLedger,
  type LedgerEntry,
  type OrbitalId,
  type EntityId,
  type PageId,
} from '../src/types/index';
import type { OrbitalSchema } from '../src/types/index';

const KINDS: ReadonlyArray<{
  kind: IdKind;
  prefix: string;
  is: (v: string) => boolean;
  as: (v: string) => string;
}> = [
  { kind: 'orbital', prefix: 'orb_', is: isOrbitalId, as: asOrbitalId },
  { kind: 'entity', prefix: 'ent_', is: isEntityId, as: asEntityId },
  { kind: 'trait', prefix: 'trt_', is: isTraitId, as: asTraitId },
  { kind: 'event', prefix: 'evt_', is: isEventId, as: asEventId },
  { kind: 'page', prefix: 'pag_', is: isPageId, as: asPageId },
  { kind: 'service', prefix: 'svc_', is: isServiceId, as: asServiceId },
  { kind: 'theme', prefix: 'thm_', is: isThemeId, as: asThemeId },
  { kind: 'palette', prefix: 'pal_', is: isPaletteEntryId, as: asPaletteEntryId },
];

describe('identity: mint / guard / as round-trips', () => {
  for (const { kind, prefix, is, as } of KINDS) {
    it(`${kind}: mints a prefixed id that its own guard/constructor accept`, () => {
      const id = mintId(kind);
      expect(id.startsWith(prefix)).toBe(true);
      expect(is(id)).toBe(true);
      expect(as(id)).toBe(id);
    });

    it(`${kind}: guard rejects and constructor throws on a foreign prefix`, () => {
      const foreign = 'xyz_0000000000';
      expect(is(foreign)).toBe(false);
      expect(() => as(foreign)).toThrow();
    });

    it(`${kind}: guard rejects a bare prefix with no ULID body`, () => {
      expect(is(prefix)).toBe(false);
    });
  }

  it('each kind guard rejects every other kind (no cross-acceptance)', () => {
    for (const a of KINDS) {
      const id = mintId(a.kind);
      for (const b of KINDS) {
        expect(b.is(id)).toBe(a.kind === b.kind);
      }
    }
  });
});

describe('identity: ULID shape + monotonic-ish timestamp prefix', () => {
  const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]+$/;

  it('mints a 26-char Crockford body after the prefix', () => {
    const id = mintId('orbital');
    const body = id.slice('orb_'.length);
    expect(body.length).toBe(26);
    expect(CROCKFORD.test(body)).toBe(true);
  });

  it('ids are unique across a burst', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(mintId('trait'));
    expect(seen.size).toBe(1000);
  });

  it('time-prefix is non-decreasing across mints separated in time', async () => {
    const first = mintId('event').slice('evt_'.length, 'evt_'.length + 10);
    await new Promise((r) => setTimeout(r, 5));
    const second = mintId('event').slice('evt_'.length, 'evt_'.length + 10);
    expect(second >= first).toBe(true);
  });
});

function makeLedger(): IdentityLedger {
  const orb = mintId('orbital');
  const ent = mintId('entity');
  const entries: Record<string, LedgerEntry> = {
    [orb]: {
      id: orb,
      kind: 'orbital',
      bakedName: 'Physics',
      curName: 'Physics',
      renames: [],
      owner: 'workspace',
    },
    [ent]: {
      id: ent,
      kind: 'entity',
      bakedName: 'Body',
      curName: 'Body',
      renames: [],
      owner: 'std',
    },
  };
  return { schemaVersion: 1, entries };
}

describe('identity: ledger resolve / rename / curName', () => {
  it('resolveName matches exact curName within kind', () => {
    const ledger = makeLedger();
    const id = ledgerResolveName(ledger, 'entity', 'Body');
    expect(id).not.toBeNull();
    expect(ledger.entries[id as string].kind).toBe('entity');
  });

  it('resolveName does not cross kinds and returns null on miss', () => {
    const ledger = makeLedger();
    expect(ledgerResolveName(ledger, 'trait', 'Body')).toBeNull();
    expect(ledgerResolveName(ledger, 'entity', 'Nope')).toBeNull();
  });

  it('curName reads the current label, null when absent', () => {
    const ledger = makeLedger();
    const id = ledgerResolveName(ledger, 'orbital', 'Physics') as string;
    expect(ledgerCurName(ledger, id)).toBe('Physics');
    expect(ledgerCurName(ledger, 'orb_missing')).toBeNull();
  });

  it('rename is immutable — original ledger untouched, new one updated', () => {
    const ledger = makeLedger();
    const id = ledgerResolveName(ledger, 'orbital', 'Physics') as string;
    const before = ledger.entries[id];
    const next = ledgerRename(ledger, id, 'PhysicsSim', '2026-07-14T00:00:00Z');

    // Original object identity + values unchanged.
    expect(next).not.toBe(ledger);
    expect(ledger.entries[id]).toBe(before);
    expect(ledger.entries[id].curName).toBe('Physics');
    expect(ledger.entries[id].renames.length).toBe(0);

    // New ledger reflects the edit and records history.
    expect(next.entries[id].curName).toBe('PhysicsSim');
    expect(next.entries[id].renames).toEqual([
      { from: 'Physics', to: 'PhysicsSim', at: '2026-07-14T00:00:00Z' },
    ]);
    expect(ledgerCurName(next, id)).toBe('PhysicsSim');
    expect(ledgerResolveName(next, 'orbital', 'PhysicsSim')).toBe(id);
    expect(ledgerResolveName(next, 'orbital', 'Physics')).toBeNull();
  });

  it('chained renames compose into one history array', () => {
    const ledger = makeLedger();
    const id = ledgerResolveName(ledger, 'entity', 'Body') as string;
    const a = ledgerRename(ledger, id, 'RigidBody', 't1');
    const b = ledgerRename(a, id, 'SoftBody', 't2');
    expect(b.entries[id].curName).toBe('SoftBody');
    expect(b.entries[id].renames.map((r) => r.to)).toEqual(['RigidBody', 'SoftBody']);
  });

  it('rename of an unknown id is a no-op returning the same ledger', () => {
    const ledger = makeLedger();
    expect(ledgerRename(ledger, 'orb_unknown', 'X', 't')).toBe(ledger);
  });
});

describe('identity: schema JSON round-trip (id-present and id-absent)', () => {
  it('a schema carrying ids survives JSON.parse(JSON.stringify) with types intact', () => {
    const orb = mintId('orbital');
    const ent = mintId('entity');
    const pag = mintId('page');
    const withIds: OrbitalSchema = {
      name: 'App',
      schemaVersion: 1,
      ledger: {
        schemaVersion: 1,
        entries: {
          [orb]: {
            id: orb,
            kind: 'orbital',
            bakedName: 'App',
            curName: 'App',
            renames: [],
            owner: 'workspace',
          },
        },
      },
      orbitals: [
        {
          id: orb as OrbitalId,
          name: 'App',
          entity: {
            id: ent as EntityId,
            name: 'Body',
            fields: [{ name: 'mass', type: 'number' }],
          },
          traits: [],
          pages: [
            { id: pag as PageId, name: 'Home', path: '/' },
          ],
        },
      ],
    };

    const round = JSON.parse(JSON.stringify(withIds)) as OrbitalSchema;
    expect(round).toEqual(withIds);
    expect(round.schemaVersion).toBe(1);
    expect(round.ledger?.entries[orb].curName).toBe('App');
    // Ids survive as their string values and re-narrow through the guards.
    expect(isOrbitalId(round.orbitals[0].id as string)).toBe(true);
  });

  it('a schema with NO ids survives the round-trip unchanged', () => {
    const noIds: OrbitalSchema = {
      name: 'App',
      orbitals: [
        {
          name: 'App',
          entity: { name: 'Body', fields: [{ name: 'mass', type: 'number' }] },
          traits: [],
          pages: [{ name: 'Home', path: '/' }],
        },
      ],
    };
    const round = JSON.parse(JSON.stringify(noIds)) as OrbitalSchema;
    expect(round).toEqual(noIds);
    expect(round.schemaVersion).toBeUndefined();
    expect(round.ledger).toBeUndefined();
    expect(round.orbitals[0].id).toBeUndefined();
  });
});
