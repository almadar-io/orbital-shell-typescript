/**
 * A browser-stored entity may write its first rows per locale
 * (`instances ar [ … ]`); the seed takes the viewer's locale block, else the
 * default `instances`. Twin of orbital-core `EntityDefinition::instances_for_locale`.
 */
import { describe, it, expect } from 'vitest';
import { EntitySchema, instancesForLocale, type OrbitalEntity } from '../src/types/entity';

const invoice: OrbitalEntity = {
  name: 'Invoice', persistence: 'persistent', collection: 'invoices', local: true,
  fields: [{ name: 'id', type: 'string', required: true }, { name: 'client', type: 'string' }],
  instances: [{ id: 'C-1', client: 'Noor Logistics' }],
  localeInstances: { ar: [{ id: 'C-1', client: 'نور للخدمات اللوجستية' }] },
};

describe('locale instances', () => {
  it('survive the schema parse', () => {
    expect(EntitySchema.parse(invoice).localeInstances).toEqual(invoice.localeInstances);
  });

  it('the viewer locale takes its own block', () => {
    expect(instancesForLocale(invoice, 'ar')).toEqual([{ id: 'C-1', client: 'نور للخدمات اللوجستية' }]);
  });

  it('a locale with no block, or no locale, takes the default rows', () => {
    expect(instancesForLocale(invoice, 'sl')).toEqual(invoice.instances);
    expect(instancesForLocale(invoice, undefined)).toEqual(invoice.instances);
  });

  it('control: an entity with no rows at all has none', () => {
    expect(instancesForLocale({ ...invoice, instances: undefined, localeInstances: undefined }, 'ar')).toEqual([]);
  });
});
