/**
 * The mock-seed policy, pinned before any call site moves onto it.
 *
 * Five synthesizers held four different `default` policies, so the same entity
 * seeded differently depending on which path rendered it. Everything here is
 * asserted under BOTH entropy strategies because the policy is strategy-invariant
 * — only the value generators differ.
 */

import { describe, it, expect } from 'vitest';
import type { EntityField } from '../src/types/field.js';
import {
  IMAGE_FIELD_NAMES,
  isDeclaredDefaultHonored,
  sampleFieldValue,
  sampleRowCount,
  sampleRows,
  seedRandom,
  type SampleContext,
  type SampleEntity,
  type SampleStrategy,
} from '../src/mock/index.js';

const STRATEGIES: SampleStrategy[] = ['seeded', 'index'];

function ctx(strategy: SampleStrategy, index = 1, persistence?: 'persistent' | 'runtime'): SampleContext {
  return { entityName: 'Member', index, strategy, persistence };
}

function entity(fields: EntityField[], persistence?: 'persistent' | 'runtime'): SampleEntity {
  return { name: 'Member', persistence, fields };
}

describe.each(STRATEGIES)('mock-seed policy [%s]', (strategy) => {
  describe('declared defaults that must be honored verbatim', () => {
    it('honors a non-empty string default when the field has no vocabulary', () => {
      const f: EntityField = { name: 'title', type: 'string', default: 'Title' };
      expect(sampleFieldValue(f, ctx(strategy))).toBe('Title');
    });

    it('honors 0 and false on a runtime singleton — the falsy traps the numeric-only gate existed for', () => {
      expect(
        sampleFieldValue({ name: 'tokenCount', type: 'number', default: 0 }, ctx(strategy, 1, 'runtime')),
      ).toBe(0);
      expect(
        sampleFieldValue({ name: 'enabled', type: 'boolean', default: false }, ctx(strategy, 1, 'runtime')),
      ).toBe(false);
    });

    it('honors empty collection defaults', () => {
      expect(sampleFieldValue({ name: 'tags', type: 'array', default: [] }, ctx(strategy))).toEqual([]);
      expect(sampleFieldValue({ name: 'meta', type: 'object', default: {} }, ctx(strategy))).toEqual({});
    });

    it('honors authored ui-factory content verbatim', () => {
      const features: EntityField = {
        name: 'features',
        type: 'array',
        default: ['Item', 'Item 2'],
      };
      expect(sampleFieldValue(features, ctx(strategy))).toEqual(['Item', 'Item 2']);

      const hero: EntityField = {
        name: 'hero',
        type: 'object',
        default: { title: 'Title', action: { label: 'Label', href: 'Href' } },
      };
      expect(sampleFieldValue(hero, ctx(strategy))).toEqual({
        title: 'Title',
        action: { label: 'Label', href: 'Href' },
      });
    });
  });

  describe('placeholders that must be synthesized instead', () => {
    it('treats an empty-string default as absent', () => {
      const f: EntityField = { name: 'email', type: 'string', default: '' };
      const value = sampleFieldValue(f, ctx(strategy));
      expect(value).not.toBe('');
      expect(typeof value).toBe('string');
    });

    it('treats a null default as absent', () => {
      const f: EntityField = { name: 'note', type: 'string', default: null };
      expect(sampleFieldValue(f, ctx(strategy))).not.toBeNull();
    });

    it('gate 3: honors "" when the field\'s own vocabulary declares it', () => {
      const f: EntityField = {
        name: 'finalStatus',
        type: 'string',
        values: ['approved', 'rejected', 'escalated', ''],
        default: '',
      };
      expect(isDeclaredDefaultHonored(f)).toBe(true);
      expect(sampleFieldValue(f, ctx(strategy))).toBe('');
    });
  });

  describe('the row cycle over a declared vocabulary', () => {
    // .lolo unions lower to type:'string' WITH values, not type:'enum' — a
    // policy that only covered 'enum' would be a no-op on the real corpus.
    const asString: EntityField = {
      name: 'membershipTier',
      type: 'string',
      values: ['basic', 'premium', 'unlimited'],
      default: 'basic',
    };
    const asEnum: EntityField = {
      name: 'membershipTier',
      type: 'enum',
      values: ['basic', 'premium', 'unlimited'],
      default: 'basic',
    };

    it.each([
      ['string + values (the .lolo shape)', asString],
      ['enum', asEnum],
    ])('cycles 1-based over %s', (_label, field) => {
      const got = [1, 2, 3, 4].map((i) => sampleFieldValue(field, ctx(strategy, i)));
      expect(got).toEqual(['basic', 'premium', 'unlimited', 'basic']);
    });

    it('anchors row 1 to values[0], preserving the declared default', () => {
      expect(sampleFieldValue(asString, ctx(strategy, 1))).toBe('basic');
    });

    it('wraps cleanly past the vocabulary length', () => {
      const got = [1, 2, 3, 4, 5, 6, 7].map((i) => sampleFieldValue(asString, ctx(strategy, i)));
      expect(got).toEqual(['basic', 'premium', 'unlimited', 'basic', 'premium', 'unlimited', 'basic']);
    });
  });

  describe('a declared @mock value is used literally, never through a domain lookup', () => {
    // `required: true` on every field below so the every-other-row
    // undefaulted-optional-unset policy (see "undefaulted optional fields
    // are left unset on alternating rows" further down) doesn't turn these
    // into a mixed value/undefined assertion — these tests are about @mock
    // synthesis, not the unset policy.
    it('rotates comma-separated literal candidates by row index — the author supplies real values', () => {
      const field: EntityField = {
        name: 'clientName',
        type: 'string',
        required: true,
        mock: 'Acme Corp, Globex Inc, Wayne Enterprises',
      };
      const got = [1, 2, 3, 4].map((i) => sampleFieldValue(field, ctx(strategy, i)));
      expect(got).toEqual(['Acme Corp', 'Globex Inc', 'Wayne Enterprises', 'Acme Corp']);
    });

    it('with no comma, uses the single literal value suffixed with the row index', () => {
      const field: EntityField = { name: 'clientName', type: 'string', required: true, mock: 'person-name' };
      expect(sampleFieldValue(field, ctx(strategy, 1))).toBe('person-name-1');
      expect(sampleFieldValue(field, ctx(strategy, 2))).toBe('person-name-2');
    });

    it('with no @mock declared, falls through to ordinary type-based synthesis unchanged', () => {
      const field: EntityField = { name: 'clientName', type: 'string' };
      const got = sampleFieldValue(field, ctx(strategy, 1));
      expect(got).not.toMatch(/^person-name/);
    });

    it('seeds a numeric @mock as numbers, so sums and averages over seeded rows are real', () => {
      const field: EntityField = { name: 'uptime', type: 'number', required: true, mock: '99.99, 99.5, 100' };
      const got = [1, 2, 3].map((i) => sampleFieldValue(field, ctx(strategy, i)));
      expect(got).toEqual([99.99, 99.5, 100]);
    });

    it('seeds a money @mock as numbers', () => {
      const field: EntityField = { name: 'total', type: 'money', required: true, mock: '250000, 84000' };
      expect(sampleFieldValue(field, ctx(strategy, 2))).toBe(84000);
    });

    it('seeds a boolean @mock as booleans', () => {
      const field: EntityField = { name: 'inStock', type: 'boolean', required: true, mock: 'true, false' };
      expect([1, 2].map((i) => sampleFieldValue(field, ctx(strategy, i)))).toEqual([true, false]);
    });

    it('seeds a behavior @mock as a behavior value per row, the specifier verbatim (never index-suffixed)', () => {
      const field: EntityField = {
        name: 'behavior',
        type: 'behavior',
        required: true,
        mock: 'almadar-behaviors/std-booking-solution, almadar-behaviors/std-accounting-solution',
      };
      const got = [1, 2, 3].map((i) => sampleFieldValue(field, ctx(strategy, i)));
      expect(got).toEqual([
        { behavior: 'almadar-behaviors/std-booking-solution' },
        { behavior: 'almadar-behaviors/std-accounting-solution' },
        { behavior: 'almadar-behaviors/std-booking-solution' },
      ]);
    });

    it('a single behavior @mock is that behavior on every row', () => {
      const field: EntityField = { name: 'behavior', type: 'behavior', required: true, mock: 'almadar-behaviors/std-booking-solution' };
      expect(sampleFieldValue(field, ctx(strategy, 2))).toEqual({ behavior: 'almadar-behaviors/std-booking-solution' });
    });

    it('control: a behavior field with no @mock still seeds none', () => {
      const field: EntityField = { name: 'behavior', type: 'behavior', required: true };
      expect(sampleFieldValue(field, ctx(strategy, 1))).toBeNull();
    });

    it('keeps a numeric-looking @mock on a string field as text', () => {
      const field: EntityField = { name: 'matterNumber', type: 'string', required: true, mock: '2026, 2027' };
      expect(sampleFieldValue(field, ctx(strategy, 1))).toBe('2026');
    });

    it('keeps a non-numeric @mock on a number field as the declared literal rather than inventing a number', () => {
      const field: EntityField = { name: 'uptime', type: 'number', required: true, mock: 'n/a, 99.5' };
      expect(sampleFieldValue(field, ctx(strategy, 1))).toBe('n/a');
    });
  });

  describe('gate 1 — runtime singletons', () => {
    const boardResult: EntityField = {
      name: 'result',
      type: 'string',
      values: ['none', 'victory', 'defeat'],
      default: 'none',
    };

    it('seeds exactly one row for a runtime entity', () => {
      expect(sampleRowCount(entity([boardResult], 'runtime'), 6)).toBe(1);
      expect(sampleRows(entity([boardResult], 'runtime'), 6, strategy)).toHaveLength(1);
    });

    it('seeds the requested count for a persistent entity', () => {
      expect(sampleRowCount(entity([boardResult], 'persistent'), 6)).toBe(6);
      expect(sampleRows(entity([boardResult], 'persistent'), 6, strategy)).toHaveLength(6);
    });

    it('C-MOCK-SEED-STRING-DEFAULT-IGNORED: a board never boots into game-over', () => {
      const rows = sampleRows(entity([boardResult], 'runtime'), 6, strategy);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.result).toBe('none');
    });

    it('the same field on a collection does cycle', () => {
      const rows = sampleRows(entity([boardResult], 'persistent'), 3, strategy);
      expect(rows.map((r) => r.result)).toEqual(['none', 'victory', 'defeat']);
    });

    // C-MOCK-SEED-NUMBER-DEFAULT-FLATTENED: a `= 0`-style number/boolean
    // default is a runtime singleton's real starting state (honored
    // verbatim there, same falsy-trap protection as above) but on a
    // persistent, multi-row entity it's a new-record default only — every
    // row honoring it verbatim made every mock-seeded counter/amount field
    // (`debit`, `hours`, `costRate`, `amount`, ...) read as uniformly zero
    // across the whole collection. Confirmed 2026-09-17.
    it('honors a 0/false default verbatim on a runtime singleton', () => {
      const counter: EntityField = { name: 'tokenCount', type: 'number', default: 0, required: true };
      const rows = sampleRows(entity([counter], 'runtime'), 6, strategy);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenCount).toBe(0);
    });

    it('does NOT flatten a 0/false default across a persistent collection — it randomizes', () => {
      const counter: EntityField = { name: 'tokenCount', type: 'number', default: 0, required: true };
      const rows = sampleRows(entity([counter], 'persistent'), 6, strategy);
      expect(rows).toHaveLength(6);
      expect(rows.every((r) => r.tokenCount === 0)).toBe(false);
      for (const row of rows) expect(typeof row.tokenCount).toBe('number');
    });
  });

  describe('gate 2 — intrinsic fields belong to the owning trait', () => {
    it('returns the default when one is declared', () => {
      const f: EntityField = { name: 'currentStepIndex', type: 'number', intrinsic: true, default: 0 };
      expect(sampleFieldValue(f, ctx(strategy))).toBe(0);
    });

    it('omits the key entirely when no default is declared', () => {
      const f: EntityField = { name: 'boards', type: 'array', intrinsic: true };
      expect(sampleFieldValue(f, ctx(strategy))).toBeUndefined();
      expect(sampleRows(entity([f]), 2, strategy)[0]).not.toHaveProperty('boards');
    });
  });

  describe('per-type synthesis', () => {
    it('leaves relation placeholders for the caller to link', () => {
      const one: EntityField = { name: 'owner', type: 'relation', relation: { entity: 'User', cardinality: 'one' } };
      const many: EntityField = { name: 'tags', type: 'relation', relation: { entity: 'Tag', cardinality: 'many' } };
      expect(sampleFieldValue(one, ctx(strategy))).toBe('');
      expect(sampleFieldValue(many, ctx(strategy))).toEqual([]);
    });

    it('omits slot and pattern fields', () => {
      for (const type of ['slot', 'pattern'] as const) {
        expect(sampleFieldValue({ name: 'x', type }, ctx(strategy))).toBeUndefined();
      }
    });

    it('seeds a trait field unbound (null), a value held as data', () => {
      expect(sampleFieldValue({ name: 'widget', type: 'trait' }, ctx(strategy))).toBeNull();
    });

    it('populates every declared property of an object field', () => {
      const f: EntityField = {
        name: 'position',
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
      };
      expect(sampleFieldValue(f, ctx(strategy))).toEqual({ x: expect.any(Number), y: expect.any(Number) });
    });

    it('terminates on a self-referential array instead of blowing the stack', () => {
      const comment: EntityField = { name: 'replies', type: 'array' };
      comment.items = comment;
      expect(() => sampleFieldValue(comment, ctx(strategy))).not.toThrow();
    });

    it('honors a declared numeric range in both strategies', () => {
      // `required: true` so the every-other-row optional-unset policy (see
      // "undefaulted optional fields are left unset on alternating rows"
      // below) doesn't turn this into a mixed number/undefined assertion —
      // this test is about range synthesis, not the unset policy.
      const f: EntityField = { name: 'rating', type: 'number', min: 1, max: 5, required: true };
      for (const i of [1, 2, 3, 4, 5, 6]) {
        const v = sampleFieldValue(f, ctx(strategy, i));
        expect(typeof v).toBe('number');
        expect(v as number).toBeGreaterThanOrEqual(1);
        expect(v as number).toBeLessThanOrEqual(5);
      }
    });

    it('renders a date as date-only and a datetime with time', () => {
      expect(sampleFieldValue({ name: 'joinedAt', type: 'date' }, ctx(strategy))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(sampleFieldValue({ name: 'seenAt', type: 'datetime' }, ctx(strategy))).toMatch(/T/);
    });

    it('keeps the image-name stopgap alive until a real image type exists', () => {
      expect(IMAGE_FIELD_NAMES.has('imageurl')).toBe(true);
      const f: EntityField = { name: 'imageUrl', type: 'string' };
      expect(sampleFieldValue(f, ctx(strategy))).toContain('picsum.photos');
    });

    it('documents how narrow the stopgap actually is — compound names miss it', () => {
      // `coverImage`/`profileImage` are NOT in the list (only `cover`/`coverurl`
      // are), so they already render as text today. Pinned so the reach of the
      // list is a measured fact rather than an assumption when it is retired.
      expect(IMAGE_FIELD_NAMES.has('coverimage')).toBe(false);
      const f: EntityField = { name: 'coverImage', type: 'string' };
      expect(sampleFieldValue(f, ctx(strategy))).not.toContain('picsum.photos');
    });
  });
});

describe('undefaulted optional fields are left unset on alternating rows', () => {
  // A required field, a defaulted optional, and an undefaulted optional —
  // the three shapes the policy must tell apart.
  const fields: EntityField[] = [
    { name: 'title', type: 'string', required: true },
    { name: 'priority', type: 'string', values: ['low', 'high'], default: 'low' },
    { name: 'assigneeNote', type: 'string' },
    { name: 'status', type: 'string', values: ['open', 'resolved'] },
  ];

  it('omits the undefaulted optional on every EVEN seeded row, keeps it on every ODD row', () => {
    const rows = sampleRows(entity(fields), 6, 'seeded');
    expect(rows).toHaveLength(6);
    rows.forEach((row, i) => {
      const rowNumber = i + 1;
      if (rowNumber % 2 === 0) {
        expect(row).not.toHaveProperty('assigneeNote');
      } else {
        expect(row).toHaveProperty('assigneeNote');
        expect(typeof row.assigneeNote).toBe('string');
      }
    });
  });

  it('never omits the required or the defaulted-optional field, on any row', () => {
    const rows = sampleRows(entity(fields), 6, 'seeded');
    for (const row of rows) {
      expect(row).toHaveProperty('title');
      expect(row).toHaveProperty('priority');
    }
  });

  it('enum-typed optional fields follow the same rule as any other optional field', () => {
    const rows = sampleRows(entity(fields), 6, 'seeded');
    rows.forEach((row, i) => {
      const rowNumber = i + 1;
      if (rowNumber % 2 === 0) {
        expect(row).not.toHaveProperty('status');
      } else {
        expect(['open', 'resolved']).toContain(row.status);
      }
    });
  });

  it('relation fields are never affected — a placeholder is always present for the linking pass', () => {
    const relationFields: EntityField[] = [
      { name: 'owner', type: 'relation', relation: { entity: 'User', cardinality: 'one' } },
    ];
    const rows = sampleRows(entity(relationFields), 6, 'seeded');
    for (const row of rows) {
      expect(row).toHaveProperty('owner');
      expect(row.owner).toBe('');
    }
  });

  it('the index strategy stays complete — a synthesized payload must carry every field', () => {
    const rows = sampleRows(entity(fields), 6, 'index');
    for (const row of rows) {
      expect(row).toHaveProperty('assigneeNote');
      expect(row).toHaveProperty('status');
    }
  });

  it('a single-row entity always lands on row 1 and is never affected', () => {
    // A `[runtime]` singleton, or any collection seeded with exactly one row.
    const rows = sampleRows(entity(fields, 'runtime'), 6, 'seeded');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('assigneeNote');
    expect(rows[0]).toHaveProperty('status');
  });
});

describe('entropy is a parameter, not part of the policy', () => {
  it('seeded is stable under the same seed', () => {
    const e = entity([{ name: 'name', type: 'string' }, { name: 'score', type: 'number' }]);
    seedRandom(42);
    const first = sampleRows(e, 4, 'seeded');
    seedRandom(42);
    expect(sampleRows(e, 4, 'seeded')).toEqual(first);
  });

  it('index is referentially transparent — the parity-testable strategy', () => {
    const f: EntityField = { name: 'name', type: 'string' };
    const results = Array.from({ length: 5 }, () => sampleFieldValue(f, ctx('index', 3)));
    expect(new Set(results).size).toBe(1);
  });

  it('index never consults the PRNG, so an interleaved reseed cannot move it', () => {
    const f: EntityField = { name: 'score', type: 'number' };
    const before = sampleFieldValue(f, ctx('index', 7));
    seedRandom(999);
    expect(sampleFieldValue(f, ctx('index', 7))).toBe(before);
  });
});

describe('reserved keys are the caller\'s to stamp', () => {
  it('never synthesizes id, createdAt or updatedAt', () => {
    const e = entity([
      { name: 'id', type: 'string' },
      { name: 'createdAt', type: 'datetime' },
      { name: 'updatedAt', type: 'datetime' },
      { name: 'name', type: 'string' },
    ]);
    const row = sampleRows(e, 1, 'index')[0]!;
    expect(row).not.toHaveProperty('id');
    expect(row).not.toHaveProperty('createdAt');
    expect(row).not.toHaveProperty('updatedAt');
    expect(row).toHaveProperty('name');
  });
});

// Recursive named struct types: `type: 'union'` carries variant NAMES (a
// tagged struct union) or a by-name recursive back-reference — never a real
// enum vocabulary. Mirrors the Rust-side fix and the dedicated
// `FieldType::Union` arm in `orbital-core/src/runtime/seed.rs`.
describe.each(STRATEGIES)('union fields are never read as an enum vocabulary [%s]', (strategy) => {
  it('a genuine string enum still samples from its declared values', () => {
    const f: EntityField = { name: 'status', type: 'string', values: ['open', 'closed'] };
    expect(['open', 'closed']).toContain(sampleFieldValue(f, ctx(strategy)));
  });

  it('a tagged union samples the FIRST declared variant, never the variant name', () => {
    const f: EntityField = {
      name: 'shape',
      type: 'union',
      values: ['DrawCircle', 'DrawSquare'],
      properties: {
        DrawCircle: { type: 'object', properties: { radius: { type: 'number' } } },
        DrawSquare: { type: 'object', properties: { side: { type: 'number' } } },
      },
    };
    const value = sampleFieldValue(f, ctx(strategy));
    expect(value).not.toBe('DrawCircle');
    expect(value).not.toBe('DrawSquare');
    expect(value).toEqual(expect.objectContaining({ radius: expect.anything() }));
  });

  it('a by-name recursive back-reference (values, no properties) is omitted, not sampled as its own name', () => {
    // The shape a self-referential struct alias's recursion point carries
    // (`type MenuItem = { subMenu : [MenuItem] }`): `values: ['MenuItem']`,
    // NO `properties`.
    const f: EntityField = { name: 'subMenu', type: 'union', values: ['MenuItem'] };
    expect(sampleFieldValue(f, ctx(strategy))).toBeUndefined();
  });

  it('a recursive struct field samples its own properties, and the back-reference child is omitted', () => {
    const e = entity([
      {
        name: 'root',
        type: 'object',
        properties: {
          label: { type: 'string', required: true },
          subMenu: {
            type: 'array',
            items: { type: 'union', values: ['MenuItem'] },
          },
        },
      },
    ]);
    const row = sampleRows(e, 1, strategy)[0]! as Record<string, unknown>;
    const root = row.root as Record<string, unknown>;
    expect(typeof root.label).toBe('string');
    // The array itself samples fine (empty items are fine); each element, if
    // any were seeded, must never be the literal string "MenuItem".
    expect(root.subMenu).not.toBe('MenuItem');
  });
});

describe('object properties draw in sorted key order', () => {
  it('seeds the same values whatever order the properties were declared in', () => {
    const a = { name: 'meta', type: 'object' as const, properties: { zeta: { type: 'number' as const }, alpha: { type: 'number' as const } } };
    const b = { name: 'meta', type: 'object' as const, properties: { alpha: { type: 'number' as const }, zeta: { type: 'number' as const } } };
    seedRandom(7);
    const first = sampleFieldValue(a, { entityName: 'E', index: 1, strategy: 'seeded' });
    seedRandom(7);
    const second = sampleFieldValue(b, { entityName: 'E', index: 1, strategy: 'seeded' });
    expect(first).toEqual(second);
  });

  it('control: a different seed gives different values', () => {
    const a = { name: 'meta', type: 'object' as const, properties: { zeta: { type: 'number' as const }, alpha: { type: 'number' as const } } };
    seedRandom(7);
    const first = sampleFieldValue(a, { entityName: 'E', index: 1, strategy: 'seeded' });
    seedRandom(8);
    expect(sampleFieldValue(a, { entityName: 'E', index: 1, strategy: 'seeded' })).not.toEqual(first);
  });
});

describe('the every-other-row optional omission is a row-level rule', () => {
  it('never blanks an array element or an object property', () => {
    seedRandom(3);
    const tags = sampleFieldValue(
      { name: 'tags', type: 'array', required: true, items: { type: 'string' } },
      { entityName: 'E', index: 2, strategy: 'seeded' },
    );
    expect(Array.isArray(tags) && tags.every((t) => typeof t === 'string')).toBe(true);
    const meta = sampleFieldValue(
      { name: 'meta', type: 'object', required: true, properties: { note: { type: 'string' } } },
      { entityName: 'E', index: 2, strategy: 'seeded' },
    );
    expect(meta).toMatchObject({ note: expect.any(String) });
  });

  it('control: an optional row field on an even row is still left unset', () => {
    seedRandom(3);
    expect(sampleFieldValue({ name: 'note', type: 'string' }, { entityName: 'E', index: 2, strategy: 'seeded' })).toBeUndefined();
  });
});

describe('event-typed fields are never seeded', () => {
  it('omits an event field (an event name is authored, never random text)', () => {
    for (const strategy of STRATEGIES) {
      expect(sampleFieldValue({ name: 'onPick', type: 'event' }, { entityName: 'E', index: 1, strategy })).toBeUndefined();
    }
  });

  it('control: a string field beside it is still seeded', () => {
    expect(sampleFieldValue({ name: 'label', type: 'string' }, { entityName: 'E', index: 1, strategy: 'index' })).toBe('Label 1');
  });
});

describe('[identity] rows are fully populated', () => {
  const person: SampleEntity = {
    name: 'Person',
    identity: true,
    fields: [{ name: 'role', type: 'string', values: ['member', 'moderator', 'admin'] }],
  };

  it('every persona carries its role (an optional identity field is never left unset)', () => {
    seedRandom(42);
    expect(sampleRows(person, 3, 'seeded').map((r) => r['role'])).toEqual(['member', 'moderator', 'admin']);
  });

  it('control: the same optional field on an ordinary entity is still unset on even rows', () => {
    seedRandom(42);
    expect(sampleRows({ ...person, identity: false }, 3, 'seeded').map((r) => r['role'])).toEqual(['member', undefined, 'admin']);
  });
});

describe('seeded dates span months, not weeks', () => {
  // A 30-day window put every seeded date in one or two calendar months, so any
  // monthly chart over mock data drew a single point. Twin: seed.rs
  // `seeded_dates_span_months_not_weeks`.
  const DAY = 24 * 60 * 60 * 1000;
  const offsets = (): number[] => {
    seedRandom(7);
    const now = Date.now();
    return Array.from({ length: 200 }, (_, i) =>
      Date.parse(String(sampleFieldValue({ name: 'paidAt', type: 'datetime', required: true }, ctx('seeded', i + 1)))) - now);
  };

  it('stays within 120 days either side of today', () => {
    for (const o of offsets()) expect(Math.abs(o)).toBeLessThanOrEqual(120 * DAY + 60_000);
  });

  it('reaches more than two months back and more than two months ahead', () => {
    const all = offsets();
    expect(all.some((o) => o < -60 * DAY)).toBe(true);
    expect(all.some((o) => o > 60 * DAY)).toBe(true);
  });

  it('control: the index strategy still dates row n in month n', () => {
    expect(sampleFieldValue({ name: 'paidAt', type: 'date' }, ctx('index', 3))).toBe('2026-04-15');
  });
});

describe.each(STRATEGIES)('a declared @mock on an enum [%s]', (strategy) => {
  // The dashboard declared mostly-paid sample invoices and got draft/sent/paid/overdue
  // anyway: the enum rotation ran before the author's candidates. Twin: seed.rs
  // `a_declared_mock_on_an_enum_wins_over_the_rotation`.
  const status: EntityField = { name: 'status', type: 'string', values: ['draft', 'sent', 'paid'], required: true, mock: 'paid, paid, sent' };

  it('seeds the author\'s candidates, rotated by row', () => {
    expect([1, 2, 3, 4].map((i) => sampleFieldValue(status, ctx(strategy, i)))).toEqual(['paid', 'paid', 'sent', 'paid']);
  });

  it('edge: a single candidate on an enum is used as is on every row, never index-suffixed', () => {
    const one: EntityField = { ...status, mock: 'paid' };
    expect([1, 2].map((i) => sampleFieldValue(one, ctx(strategy, i)))).toEqual(['paid', 'paid']);
  });

  it('control: an enum without @mock still rotates its own values', () => {
    const plain: EntityField = { ...status, mock: undefined };
    expect([1, 2, 3, 4].map((i) => sampleFieldValue(plain, ctx(strategy, i)))).toEqual(['draft', 'sent', 'paid', 'draft']);
  });
});

describe('relative @mock dates (G-CORE-019)', () => {
  const DAY = 86_400_000;
  const INDEX_ANCHOR = Date.parse('2026-06-15T00:00:00.000Z');

  it('index strategy: a signed offset resolves against the fixed anchor, in the field\'s own format', () => {
    const posted: EntityField = { name: 'postedAt', type: 'datetime', mock: '-1d, -2h, -3w' };
    expect(sampleFieldValue(posted, ctx('index', 1))).toBe(new Date(INDEX_ANCHOR - DAY).toISOString());
    expect(sampleFieldValue(posted, ctx('index', 2))).toBe(new Date(INDEX_ANCHOR - 2 * 3_600_000).toISOString());
    expect(sampleFieldValue(posted, ctx('index', 3))).toBe(new Date(INDEX_ANCHOR - 21 * DAY).toISOString());
    expect(sampleFieldValue({ name: 'dueOn', type: 'date', mock: '+2d' }, ctx('index', 1))).toBe('2026-06-17');
  });

  it('seeded strategy: a past offset is in the past and a future one in the future', () => {
    const before = Date.now();
    const past = sampleFieldValue({ name: 'postedAt', type: 'datetime', mock: '-1d' }, ctx('seeded'));
    const future = sampleFieldValue({ name: 'dueAt', type: 'timestamp', mock: '+1w' }, ctx('seeded'));
    expect(typeof past === 'string' && Date.parse(past) < before).toBe(true);
    expect(typeof future === 'string' && Date.parse(future) > before).toBe(true);
  });

  it('control: a fixed date literal is used as written (no index suffix), and a non-date field keeps "-1d" literally', () => {
    expect(sampleFieldValue({ name: 'opened', type: 'date', mock: '2026-01-02' }, ctx('index', 2))).toBe('2026-01-02');
    expect(sampleFieldValue({ name: 'code', type: 'string', mock: '-1d, x' }, ctx('index', 1))).toBe('-1d');
  });
});
