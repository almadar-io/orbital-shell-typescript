import { describe, it, expect } from 'vitest';
import { behaviorRef, isBehaviorRefValue, isTraitValue, isOrbitalValue, FIELD_TYPES, CatalogEntrySchema, BehaviorRefSchema } from '../src/types/index.js';

describe('behavior values (a whole behavior as data)', () => {
  it('behaviorRef accepts every specifier spelling', () => {
    expect(behaviorRef('almadar-behaviors/std-crm')).toEqual({ behavior: 'almadar-behaviors/std-crm' });
    expect(behaviorRef('std/behaviors/std-kanban')).toEqual({ behavior: 'std/behaviors/std-kanban' });
    expect(behaviorRef('./orbitals/shop')).toEqual({ behavior: './orbitals/shop' });
  });

  it('behaviorRef refuses a non-specifier', () => {
    expect(() => behaviorRef('shop')).toThrow(/specifier/);
    expect(() => behaviorRef('../escape/shop')).toThrow(/specifier/);
    expect(() => behaviorRef('almadar-behaviors/std-crm.traits.Crm')).toThrow(/specifier/);
    expect(() => behaviorRef('')).toThrow(/specifier/);
  });

  it('isBehaviorRefValue is true only for a bare { behavior }', () => {
    expect(isBehaviorRefValue({ behavior: './orbitals/shop' })).toBe(true);
    expect(isBehaviorRefValue({ behavior: './orbitals/shop', trait: 'ShopBrowse' })).toBe(false);
    expect(isBehaviorRefValue({ behavior: './orbitals/shop', orbital: 'Shop' })).toBe(false);
    expect(isBehaviorRefValue({ behavior: 'not a spec' })).toBe(false);
    expect(isBehaviorRefValue({ type: 'stack', behavior: './orbitals/shop' })).toBe(false);
    expect(isBehaviorRefValue('./orbitals/shop')).toBe(false);
    expect(isBehaviorRefValue(null)).toBe(false);
    expect(isBehaviorRefValue([{ behavior: './orbitals/shop' }])).toBe(false);
  });

  it('control: trait and orbital guards do not claim a behavior value', () => {
    const value = behaviorRef('./orbitals/shop');
    expect(isTraitValue(value)).toBe(false);
    expect(isOrbitalValue(value)).toBe(false);
  });

  it('behavior is a field type', () => {
    expect(FIELD_TYPES).toContain('behavior');
  });

  describe('a catalog entry carries its behavior as a value', () => {
    const entry = {
      behavior: 'almadar-behaviors/std-crm',
      package: '@almadar-io/behaviors',
      topic: 'app',
      level: 'organism',
      description: 'A CRM.',
      capabilities: [],
      traits: [{ behavior: 'almadar-behaviors/std-crm', trait: 'CrmBrowse' }],
      value: { behavior: 'almadar-behaviors/std-crm' },
      vectors: {},
      model: '',
    };

    it('parses an entry whose value names its own behavior', () => {
      const parsed = CatalogEntrySchema.parse(entry);
      expect(isBehaviorRefValue(parsed.value)).toBe(true);
    });

    it('control: an entry without a value is refused', () => {
      const { value: _value, ...without } = entry;
      expect(CatalogEntrySchema.safeParse(without).success).toBe(false);
    });

    it('control: a value that is not a specifier is refused', () => {
      expect(CatalogEntrySchema.safeParse({ ...entry, value: { behavior: 'Indigo Pioneer' } }).success).toBe(false);
    });
  });
});

describe('a behavior value is just a specifier', () => {
  it('control: a bridge or resolved key is refused', () => {
    const bridge = { listens: ['A'], emits: ['B'] };
    expect(isBehaviorRefValue({ behavior: './orbitals/shop', bridge })).toBe(false);
    expect(BehaviorRefSchema.safeParse({ behavior: './orbitals/shop', resolved: '{}' }).success).toBe(false);
  });
});
