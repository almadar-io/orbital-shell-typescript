import { describe, expect, it } from 'vitest';

import { composeBehaviors } from '../src/builders/compose-behaviors.js';
import type { OrbitalDefinition } from '../src/types/orbital.js';
import type { OrbitalSchema } from '../src/types/schema.js';
import type { LedgerEntry } from '../src/types/identity.js';
import { asOrbitalId } from '../src/types/identity.js';

function entry(id: string, curName: string, kind: LedgerEntry['kind']): LedgerEntry {
  return {
    id,
    kind,
    bakedName: curName,
    curName,
    renames: [],
    owner: 'workspace',
  };
}

function orbital(name: string, id?: string): OrbitalDefinition {
  return {
    ...(id !== undefined ? { id: asOrbitalId(id) } : {}),
    name,
    entity: `${name}Item`,
    pages: [],
    traits: [{ name: `${name}Render`, scope: 'instance' }],
  };
}

function schemaInput(
  orbitals: OrbitalDefinition[],
  ledgerEntries: LedgerEntry[],
  schemaVersion?: number,
): OrbitalSchema {
  return {
    name: 'slice',
    orbitals,
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
    ledger: {
      schemaVersion: 1,
      entries: Object.fromEntries(ledgerEntries.map(e => [e.id, e])),
    },
  };
}

describe('composeBehaviors — identity ledger union', () => {
  it('unions two input ledgers keyed by id, sorted by id', () => {
    const a = schemaInput([orbital('Alpha', 'orb_alpha')], [
      entry('orb_alpha', 'Alpha', 'orbital'),
      entry('trt_m', 'MRender', 'trait'),
    ], 1);
    const b = schemaInput([orbital('Beta', 'orb_beta')], [
      entry('orb_beta', 'Beta', 'orbital'),
      entry('trt_z', 'ZRender', 'trait'),
    ], 1);

    const { schema } = composeBehaviors({ appName: 'App', orbitals: [a, b] });

    const ledger = schema.ledger;
    expect(ledger).toBeDefined();
    if (ledger === undefined) throw new Error('expected a composed ledger');
    expect(Object.keys(ledger.entries)).toEqual(['orb_alpha', 'orb_beta', 'trt_m', 'trt_z']);
    expect(ledger.schemaVersion).toBe(1);
    expect(schema.schemaVersion).toBe(1);
  });

  it('carries schemaVersion as the max across inputs', () => {
    const a = schemaInput([orbital('Alpha', 'orb_alpha')], [entry('orb_alpha', 'Alpha', 'orbital')], 1);
    const b = schemaInput([orbital('Beta', 'orb_beta')], [entry('orb_beta', 'Beta', 'orbital')], 2);

    const { schema } = composeBehaviors({ appName: 'App', orbitals: [a, b] });

    expect(schema.schemaVersion).toBe(2);
  });

  it('preserves orbital node ids through composition', () => {
    const a = schemaInput([orbital('Alpha', 'orb_alpha')], [entry('orb_alpha', 'Alpha', 'orbital')]);
    const b = schemaInput([orbital('Beta', 'orb_beta')], [entry('orb_beta', 'Beta', 'orbital')]);

    const { schema } = composeBehaviors({ appName: 'App', orbitals: [a, b] });

    const ids = schema.orbitals.map(o => o.id);
    expect(ids).toContain('orb_alpha');
    expect(ids).toContain('orb_beta');
  });

  it('resolves a duplicate id deterministically to the first input in order', () => {
    const first = schemaInput([orbital('Shared', 'orb_shared')], [
      entry('orb_shared', 'FirstName', 'orbital'),
    ]);
    const second = schemaInput([orbital('SharedTwo', 'orb_sharedtwo')], [
      // Same id, DIFFERENT curName — one identity, resolve to the first input.
      entry('orb_shared', 'SecondName', 'orbital'),
    ]);

    const forward = composeBehaviors({ appName: 'App', orbitals: [first, second] });
    expect(forward.schema.ledger?.entries['orb_shared']?.curName).toBe('FirstName');

    const reversed = composeBehaviors({ appName: 'App', orbitals: [second, first] });
    expect(reversed.schema.ledger?.entries['orb_shared']?.curName).toBe('SecondName');
  });

  it('composes ledger-less inputs exactly as before — no identity keys added', () => {
    const bare: OrbitalDefinition[] = [orbital('Alpha'), orbital('Beta')];

    const { schema } = composeBehaviors({ appName: 'App', orbitals: bare });

    expect('ledger' in schema).toBe(false);
    expect('schemaVersion' in schema).toBe(false);
    expect(schema).toEqual({
      name: 'App',
      version: '1.0.0',
      orbitals: schema.orbitals,
    });
  });

  it('ignores ledger-less schema inputs while unioning the ones that carry ledgers', () => {
    const withLedger = schemaInput([orbital('Alpha', 'orb_alpha')], [entry('orb_alpha', 'Alpha', 'orbital')], 1);
    const withoutLedger: OrbitalSchema = { name: 'plain', orbitals: [orbital('Beta', 'orb_beta')] };

    const { schema } = composeBehaviors({ appName: 'App', orbitals: [withLedger, withoutLedger] });

    const ledger = schema.ledger;
    if (ledger === undefined) throw new Error('expected a composed ledger');
    expect(Object.keys(ledger.entries)).toEqual(['orb_alpha']);
    expect(schema.schemaVersion).toBe(1);
  });
});
