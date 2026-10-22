/**
 * Browser-stored entities: `[persistent: x, local]` declares that an entity's rows
 * live in the browser. `isClientResident` is the one predicate both paths ask.
 */
import { describe, it, expect } from 'vitest';
import { OrbitalEntitySchema, isClientResident, storesRowsInBrowser, type OrbitalEntity } from '../src/types/entity';

const fields = [{ name: 'id', type: 'string' as const, required: true }];

describe('local entity flags survive the schema', () => {
  it('keeps local and seedMock', () => {
    const parsed = OrbitalEntitySchema.parse({ name: 'Invoice', persistence: 'persistent', collection: 'invoices', local: true, seedMock: true, fields });
    expect(parsed.local).toBe(true);
    expect(parsed.seedMock).toBe(true);
  });

  it('control: an entity without them parses with both absent', () => {
    const parsed = OrbitalEntitySchema.parse({ name: 'Invoice', collection: 'invoices', fields });
    expect(parsed.local).toBeUndefined();
    expect(parsed.seedMock).toBeUndefined();
  });

  it('rejects a non-boolean local', () => {
    expect(() => OrbitalEntitySchema.parse({ name: 'Invoice', local: 'yes', fields })).toThrow();
  });
});

describe('isClientResident', () => {
  const entity = (e: Partial<OrbitalEntity>): OrbitalEntity => ({ name: 'E', fields, ...e });

  it('a [runtime] entity lives in the client', () => {
    expect(isClientResident(entity({ persistence: 'runtime' }))).toBe(true);
  });

  it('a [persistent, local] entity lives in the client', () => {
    expect(isClientResident(entity({ persistence: 'persistent', local: true }))).toBe(true);
  });

  it('control: a plain persistent entity lives on the server', () => {
    expect(isClientResident(entity({ persistence: 'persistent' }))).toBe(false);
  });

  it('control: default persistence (absent) lives on the server', () => {
    expect(isClientResident(entity({}))).toBe(false);
  });
});

describe('storesRowsInBrowser', () => {
  const entity = (e: Partial<OrbitalEntity>): OrbitalEntity => ({ name: 'E', fields, ...e });

  it('a [persistent, local] entity stores its rows in the browser', () => {
    expect(storesRowsInBrowser(entity({ persistence: 'persistent', local: true }))).toBe(true);
  });

  it('control: a [runtime] entity keeps its rows in the server per-session store', () => {
    expect(storesRowsInBrowser(entity({ persistence: 'runtime' }))).toBe(false);
  });

  it('control: a plain persistent entity stores its rows on the server', () => {
    expect(storesRowsInBrowser(entity({ persistence: 'persistent' }))).toBe(false);
  });
});
