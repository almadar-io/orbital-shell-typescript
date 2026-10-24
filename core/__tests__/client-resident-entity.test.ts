/**
 * Browser-stored entities: `[persistent: x, browser]` declares that an entity's rows
 * live in the browser. `isClientResident` is the one predicate both paths ask.
 */
import { describe, it, expect } from 'vitest';
import { OrbitalEntitySchema, isClientResident, storesRowsInBrowser, type OrbitalEntity } from '../src/types/entity';

const fields = [{ name: 'id', type: 'string' as const, required: true }];

describe('browser entity flag survives the schema', () => {
  it('keeps browser', () => {
    const parsed = OrbitalEntitySchema.parse({ name: 'Invoice', persistence: 'persistent', collection: 'invoices', browser: true, fields });
    expect(parsed.browser).toBe(true);
  });

  it('control: an entity without them parses with both absent', () => {
    const parsed = OrbitalEntitySchema.parse({ name: 'Invoice', collection: 'invoices', fields });
    expect(parsed.browser).toBeUndefined();
  });

  it('rejects a non-boolean browser', () => {
    expect(() => OrbitalEntitySchema.parse({ name: 'Invoice', browser: 'yes', fields })).toThrow();
  });
});

describe('isClientResident', () => {
  const entity = (e: Partial<OrbitalEntity>): OrbitalEntity => ({ name: 'E', fields, ...e });

  it('a [runtime] entity lives in the client', () => {
    expect(isClientResident(entity({ persistence: 'runtime' }))).toBe(true);
  });

  it('a [persistent, browser] entity lives in the client', () => {
    expect(isClientResident(entity({ persistence: 'persistent', browser: true }))).toBe(true);
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

  it('a [persistent, browser] entity stores its rows in the browser', () => {
    expect(storesRowsInBrowser(entity({ persistence: 'persistent', browser: true }))).toBe(true);
  });

  it('control: a [runtime] entity keeps its rows in the server per-session store', () => {
    expect(storesRowsInBrowser(entity({ persistence: 'runtime' }))).toBe(false);
  });

  it('control: a plain persistent entity stores its rows on the server', () => {
    expect(storesRowsInBrowser(entity({ persistence: 'persistent' }))).toBe(false);
  });
});
