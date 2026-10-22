import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EntityRowSchema } from '../src/types/entity.js';
import { ROW_SET_MARKER, RowSetRefSchema, isRowSetMarker } from '../src/types/row-set.js';
import type { EntityRow, QueryCapabilities, RowPredicate, RowWriteOutcome } from '../src/types/index.js';
import {
  RowPredicateSchema,
  RowQuerySchema,
  compareByField,
  nearestRows,
  NearestQueryError,
  orderRows,
  FULL_QUERY_CAPABILITIES,
  FULL_WRITE_CAPABILITIES,
  QueryCapabilitiesSchema,
  QueryDeclinedError,
  WriteDeclinedError,
  RowWriteBatchSchema,
  RowWriteOpSchema,
  RowWriteOutcomeSchema,
  WriteCapabilitiesSchema,
  queryUnsupportedReason,
  resolveRowSet,
  rowMatchesPredicate,
  runRowIds,
  runRowQuery,
  runRowWrite,
  runRowWriteBatch,
} from '../src/row-query.js';

// Copied from orbital-rust/crates/orbital-core/tests/baked/pushdown/query-cases.json (the shared push-down fixture); keep in sync.
const FixtureSchema = z.object({
  rows: z.array(EntityRowSchema),
  cases: z.array(
    z.object({
      name: z.string(),
      query: RowQuerySchema,
      expect: z.object({ ids: z.array(z.string()), total: z.number() }),
    }),
  ),
  errorCases: z.array(z.object({ name: z.string(), query: RowQuerySchema, expect: z.object({ error: z.string() }) })),
});
const fixture = FixtureSchema.parse(JSON.parse(readFileSync(join(__dirname, 'fixtures/pushdown/query-cases.json'), 'utf8')));

const WriteFixtureSchema = z.object({
  rows: z.array(EntityRowSchema),
  cases: z.array(
    z.object({
      name: z.string(),
      op: RowWriteOpSchema.optional(),
      batch: RowWriteBatchSchema.optional(),
      expect: z.object({ outcomes: z.array(z.record(z.union([z.string(), EntityRowSchema]))), rows: z.array(EntityRowSchema) }),
    }),
  ),
});
const ResolveFixtureSchema = z.object({
  rows: z.array(EntityRowSchema),
  idCases: z.array(z.object({ name: z.string(), query: RowQuerySchema, expect: z.object({ ids: z.array(z.string()), total: z.number() }) })),
  resolveCases: z.array(
    z.object({
      name: z.string(),
      ref: RowSetRefSchema,
      policy: RowPredicateSchema.optional(),
      add: z.array(EntityRowSchema).optional(),
      set: z.array(z.object({ id: z.string(), fields: EntityRowSchema })).optional(),
      expect: z.object({ ids: z.array(z.string()), total: z.number() }) }),
  ),
});

describe('runRowQuery over the shared push-down cases', () => {
  it('reads the 45 recorded cases', () => {
    expect(fixture.cases).toHaveLength(45);
  });
  for (const c of fixture.cases) {
    it(c.name, () => {
      const page = runRowQuery(fixture.rows, c.query);
      expect(page.rows.map((r) => r.id)).toEqual(c.expect.ids);
      expect(page.total).toBe(c.expect.total);
    });
  }
  for (const c of fixture.errorCases) {
    it(`${c.name} fails the query`, () => {
      expect(() => runRowQuery(fixture.rows, c.query)).toThrow(NearestQueryError);
      expect(() => runRowQuery(fixture.rows, c.query)).toThrow(c.expect.error);
      expect(() => runRowIds(fixture.rows, c.query)).toThrow(c.expect.error);
    });
    it(`${c.name}: control, the same query with a well-formed vector answers`, () => {
      const nearest = c.query.nearest;
      if (nearest === undefined) throw new Error('an error case carries nearest');
      expect(() => runRowQuery(fixture.rows, { ...c.query, nearest: { ...nearest, vector: [1, 0, 0] } })).not.toThrow();
    });
  }
  it('control: a wrong expectation is detected', () => {
    const page = runRowQuery(fixture.rows, { filter: { kind: 'compare', field: 'status', op: '==', value: 'open' } });
    expect(page.rows.map((r) => r.id)).not.toEqual(['t01']);
  });
});

describe('rowMatchesPredicate edge cases', () => {
  const row: EntityRow = { id: 'x', n: 0, s: 'Ab', nil: null, tags: ['a'], d: new Date(5) };
  const m = (p: RowPredicate) => rowMatchesPredicate(row, p);
  it('empty all is true, empty any is false', () => {
    expect(m({ kind: 'all', of: [] })).toBe(true);
    expect(m({ kind: 'any', of: [] })).toBe(false);
  });
  it('zero is a value', () => {
    expect(m({ kind: 'compare', field: 'n', op: '==', value: 0 })).toBe(true);
    expect(m({ kind: 'isNull', field: 'n', isNull: true })).toBe(false);
  });
  it('null and missing behave the same', () => {
    for (const field of ['nil', 'absent']) {
      expect(m({ kind: 'isNull', field, isNull: true })).toBe(true);
      expect(m({ kind: 'compare', field, op: '!=', value: 'v' })).toBe(true);
      expect(m({ kind: 'compare', field, op: '!=', value: null })).toBe(false);
      expect(m({ kind: 'compare', field, op: '==', value: null })).toBe(false);
      expect(m({ kind: 'compare', field, op: '<', value: 1 })).toBe(false);
      expect(m({ kind: 'not', of: { kind: 'compare', field, op: '>', value: 1 } })).toBe(true);
    }
  });
  it('compares only values of one kind', () => {
    expect(m({ kind: 'compare', field: 'n', op: '<', value: 'z' })).toBe(false);
    expect(m({ kind: 'compare', field: 's', op: '>', value: 1 })).toBe(false);
    expect(m({ kind: 'compare', field: 'd', op: '>=', value: new Date(5) })).toBe(true);
    expect(m({ kind: 'compare', field: 'd', op: '==', value: new Date(5) })).toBe(true);
  });
  it('member and hasElement need a present value', () => {
    expect(m({ kind: 'member', field: 's', values: ['Ab'] })).toBe(true);
    expect(m({ kind: 'member', field: 'nil', values: [null] })).toBe(false);
    expect(m({ kind: 'hasElement', field: 'tags', value: 'a' })).toBe(true);
    expect(m({ kind: 'hasElement', field: 's', value: 'A' })).toBe(false);
  });
  it('member matches dates by time and never NaN, a number never a date', () => {
    const r: EntityRow = { id: 'y', d: new Date(5), nan: Number.NaN, z: -0, n: 5 };
    expect(rowMatchesPredicate(r, { kind: 'member', field: 'd', values: [new Date(5)] })).toBe(true);
    expect(rowMatchesPredicate(r, { kind: 'member', field: 'd', values: [5] })).toBe(false);
    expect(rowMatchesPredicate(r, { kind: 'member', field: 'n', values: [new Date(5)] })).toBe(false);
    expect(rowMatchesPredicate(r, { kind: 'member', field: 'nan', values: [Number.NaN] })).toBe(false);
    expect(rowMatchesPredicate(r, { kind: 'member', field: 'z', values: [0] })).toBe(true);
  });
  it('control: member over many values still matches only listed ones', () => {
    const values = Array.from({ length: 5000 }, (_, i) => `id-${i}`);
    const p: RowPredicate = { kind: 'member', field: 'id', values };
    expect(rowMatchesPredicate({ id: 'id-4999' }, p)).toBe(true);
    expect(rowMatchesPredicate({ id: 'id-5000' }, p)).toBe(false);
  });
  it('contains on a non-string field fails', () => {
    expect(m({ kind: 'contains', field: 'n', text: '0', caseSensitive: true })).toBe(false);
    expect(m({ kind: 'contains', field: 's', text: 'AB', caseSensitive: false })).toBe(true);
    expect(m({ kind: 'contains', field: 's', text: 'AB', caseSensitive: true })).toBe(false);
  });
});

describe('ordering', () => {
  it('compares strings by code point, not UTF-16 unit', () => {
    const rows: EntityRow[] = [{ id: 'a', s: '\u{1F600}' }, { id: 'b', s: '￿' }];
    const page = runRowQuery(rows, { order: { field: 's', direction: 'asc' } });
    expect(page.rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('desc keeps id ascending among ties and missing last', () => {
    const rows: EntityRow[] = [{ id: 'c', v: 1 }, { id: 'a', v: 1 }, { id: 'b' }, { id: 'd', v: 2 }];
    const page = runRowQuery(rows, { order: { field: 'v', direction: 'desc' } });
    expect(page.rows.map((r) => r.id)).toEqual(['d', 'a', 'c', 'b']);
  });
  it('an unordered query is createdAt ascending, a row without one last, ties by id (EXEC-FETCH-1)', () => {
    const rows: EntityRow[] = [
      { id: 'a', createdAt: '2026-03-02T00:00:00.000Z' },
      { id: 'b' },
      { id: 'c', createdAt: '2026-03-01T00:00:00.000Z' },
      { id: 'd', createdAt: '2026-03-02T00:00:00.000Z' },
      { id: 'e', createdAt: null },
    ];
    expect(runRowQuery(rows, {}).rows.map((r) => r.id)).toEqual(['c', 'a', 'd', 'b', 'e']);
    expect(orderRows(rows, undefined).map((r) => r.id)).toEqual(['c', 'a', 'd', 'b', 'e']);
  });
  it('control: an authored order replaces the default, and desc is not reversed by the default', () => {
    const rows: EntityRow[] = [{ id: 'a', createdAt: '2026-03-01T00:00:00.000Z', v: 1 }, { id: 'b', createdAt: '2026-03-02T00:00:00.000Z', v: 2 }];
    expect(runRowQuery(rows, { order: { field: 'v', direction: 'desc' } }).rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(runRowQuery(rows, {}).rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('a createdAt of mixed kinds still has one total order: number, then string', () => {
    const rows: EntityRow[] = [{ id: 'a', createdAt: '2026-03-01T00:00:00.000Z' }, { id: 'b', createdAt: 5 }, { id: 'c', createdAt: 3 }];
    expect(runRowQuery(rows, {}).rows.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
  it('compareByField alone does not break ties', () => {
    expect(compareByField('v', 'asc')({ id: 'a', v: 1 }, { id: 'b', v: 1 })).toBe(0);
  });
  it('does not mutate its input', () => {
    const rows: EntityRow[] = [{ id: 'b' }, { id: 'a' }];
    runRowQuery(rows, {});
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('schemas', () => {
  it('accepts a nested predicate and rejects an unknown kind', () => {
    const ok: RowPredicate = { kind: 'not', of: { kind: 'any', of: [{ kind: 'const', value: true }] } };
    expect(RowPredicateSchema.parse(ok)).toEqual(ok);
    expect(RowPredicateSchema.safeParse({ kind: 'like', field: 'a' }).success).toBe(false);
  });
  it('rejects a negative offset and a fractional limit', () => {
    expect(RowQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
    expect(RowQuerySchema.safeParse({ limit: 1.5 }).success).toBe(false);
  });
});

describe('queryUnsupportedReason', () => {
  const full: QueryCapabilities = FULL_QUERY_CAPABILITIES;
  const eq: RowPredicate = { kind: 'compare', field: 'a', op: '==', value: 1 };

  it('a full host accepts every recorded case', () => {
    for (const c of fixture.cases) expect(queryUnsupportedReason(full, c.query)).toBeNull();
  });
  it('a host without the nearest capability is refused nearest queries only', () => {
    const noVectors: QueryCapabilities = { ...full, nearest: false };
    for (const c of fixture.cases) {
      expect(queryUnsupportedReason(noVectors, c.query)).toBe(c.query.nearest === undefined ? null : 'nearest');
    }
    expect(queryUnsupportedReason({ ...full, nearest: undefined }, { nearest: { field: 'v', vector: [1], k: 1 } })).toBe('nearest');
  });
  it('names the first failing check, in the design order', () => {
    expect(queryUnsupportedReason({ ...full, leaves: ['member'] }, { filter: eq })).toBe('leaf-unsupported');
    expect(queryUnsupportedReason({ ...full, compareOps: ['=='] }, { policy: { kind: 'compare', field: 'a', op: '<', value: 1 } })).toBe('leaf-unsupported');
    expect(queryUnsupportedReason({ ...full, combinators: ['all'] }, { filter: { kind: 'not', of: eq } })).toBe('combinator-unsupported');
    expect(queryUnsupportedReason({ ...full, orderableFields: { kind: 'listed', fields: ['id'] } }, { order: { field: 'a', direction: 'asc' } })).toBe('order-field');
    expect(queryUnsupportedReason({ ...full, window: false }, { limit: 3 })).toBe('window');
    expect(queryUnsupportedReason({ ...full, exactTotal: false }, {})).toBe('exact-total');
  });
  it('controls: the same queries pass when the capability is present', () => {
    expect(queryUnsupportedReason({ ...full, orderableFields: { kind: 'listed', fields: ['a'] } }, { order: { field: 'a', direction: 'desc' } })).toBeNull();
    expect(queryUnsupportedReason({ ...full, window: false }, {})).toBeNull();
    expect(queryUnsupportedReason({ ...full, combinators: [] }, { filter: eq, policy: { kind: 'const', value: true } })).toBeNull();
  });
  it('checks leaves nested under combinators and in the policy', () => {
    const nested: RowPredicate = { kind: 'all', of: [{ kind: 'any', of: [{ kind: 'isNull', field: 'a', isNull: true }] }] };
    expect(queryUnsupportedReason({ ...full, leaves: ['compare'] }, { policy: nested })).toBe('leaf-unsupported');
  });
});

describe('case-insensitive contains folds Unicode', () => {
  const row: EntityRow = { id: 'x', s: 'Straße ΜΕΛΟΣ' };
  const contains = (text: string, caseSensitive: boolean) => rowMatchesPredicate(row, { kind: 'contains', field: 's', text, caseSensitive });
  it('folds ß to ss and final sigma to sigma', () => {
    expect(contains('STRASSE', false)).toBe(true);
    expect(contains('μελοσ', false)).toBe(true);
    expect(contains('μελος', false)).toBe(true);
  });
  it('controls: case-sensitive does not fold, and unrelated text still misses', () => {
    expect(contains('STRASSE', true)).toBe(false);
    expect(contains('strasse!', false)).toBe(false);
  });
});

describe('total: none', () => {
  const rows: EntityRow[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('reports the window size and lets a store without exact counts serve it', () => {
    expect(runRowQuery(rows, { limit: 2, total: 'none' }).total).toBe(2);
    expect(runRowQuery(rows, { limit: 2 }).total).toBe(3);
    expect(queryUnsupportedReason({ ...FULL_QUERY_CAPABILITIES, exactTotal: false }, { total: 'none' })).toBeNull();
    expect(queryUnsupportedReason({ ...FULL_QUERY_CAPABILITIES, exactTotal: false }, { total: 'exact' })).toBe('exact-total');
  });
});

describe('operator x value kind capabilities', () => {
  const caps: QueryCapabilities = { ...FULL_QUERY_CAPABILITIES, operatorValueKinds: [{ operator: '<', valueKinds: ['number'] }, { operator: 'member', valueKinds: ['string'] }] };
  it('refuses a listed operator on an unlisted kind, anywhere in the tree', () => {
    expect(queryUnsupportedReason(caps, { filter: { kind: 'compare', field: 'd', op: '<', value: new Date(1) } })).toBe('value-kind-unsupported');
    expect(queryUnsupportedReason(caps, { policy: { kind: 'not', of: { kind: 'member', field: 'a', values: ['x', 1] } } })).toBe('value-kind-unsupported');
  });
  it('controls: listed kind, unlisted operator, absent restrictions', () => {
    expect(queryUnsupportedReason(caps, { filter: { kind: 'compare', field: 'n', op: '<', value: 1 } })).toBeNull();
    expect(queryUnsupportedReason(caps, { filter: { kind: 'compare', field: 'd', op: '>', value: new Date(1) } })).toBeNull();
    expect(queryUnsupportedReason(FULL_QUERY_CAPABILITIES, { filter: { kind: 'compare', field: 'd', op: '<', value: new Date(1) } })).toBeNull();
  });
  it('a leaf failure outranks a value kind one', () => {
    expect(queryUnsupportedReason({ ...caps, leaves: ['compare'] }, { filter: { kind: 'all', of: [{ kind: 'member', field: 'a', values: [1] }] } })).toBe('leaf-unsupported');
  });
});

describe('the default order is a capability the store must have', () => {
  const listed = (fields: string[]): QueryCapabilities => ({ ...FULL_QUERY_CAPABILITIES, orderableFields: { kind: 'listed', fields } });
  it('an unordered query is refused by a store that cannot order by createdAt', () => {
    expect(queryUnsupportedReason(listed(['id']), {})).toBe('order-field');
  });
  it('controls: createdAt listed, an authored order on a listed field, every-field', () => {
    expect(queryUnsupportedReason(listed(['id', 'createdAt']), {})).toBeNull();
    expect(queryUnsupportedReason(listed(['id']), { order: { field: 'id', direction: 'asc' } })).toBeNull();
    expect(queryUnsupportedReason(FULL_QUERY_CAPABILITIES, {})).toBeNull();
  });
});

describe('QueryDeclinedError', () => {
  it('carries its reason', () => {
    const e = new QueryDeclinedError('window');
    expect(e).toBeInstanceOf(Error);
    expect(e.reason).toBe('window');
    expect(e.name).toBe('QueryDeclinedError');
  });
});

describe('WriteDeclinedError', () => {
  it('carries its reason and is not a QueryDeclinedError', () => {
    const e = new WriteDeclinedError('atomic-batch');
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(QueryDeclinedError);
    expect(e.reason).toBe('atomic-batch');
    expect(e.name).toBe('WriteDeclinedError');
  });
});

describe('row set markers', () => {
  const ref = { entityType: 'Item', ids: ['a'], total: 1, query: {} };
  it('recognises a marker and rejects lookalikes', () => {
    expect(isRowSetMarker({ [ROW_SET_MARKER]: true, ref })).toBe(true);
    expect(isRowSetMarker({ [ROW_SET_MARKER]: true, ref: { entityType: 'Item' } })).toBe(false);
    expect(isRowSetMarker({ [ROW_SET_MARKER]: false, ref })).toBe(false);
    expect(isRowSetMarker(['a'])).toBe(false);
    expect(isRowSetMarker(null)).toBe(false);
  });
});

describe('write and resolve schemas', () => {
  it('accept the recorded ops and outcomes and reject unknown kinds', () => {
    for (const c of writeFixture.cases) {
      if (c.op) expect(RowWriteOpSchema.parse(c.op)).toEqual(c.op);
      if (c.batch) expect(RowWriteBatchSchema.parse(c.batch)).toEqual(c.batch);
      for (const o of c.expect.outcomes.filter((x) => x.kind !== 'failed')) expect(RowWriteOutcomeSchema.parse(o)).toEqual(o);
    }
    expect(RowWriteOpSchema.safeParse({ kind: 'merge', entityType: 'X', data: {} }).success).toBe(false);
    expect(RowWriteOpSchema.safeParse({ kind: 'upsert', entityType: 'X', data: {} }).success).toBe(true);
    expect(RowWriteBatchSchema.safeParse({ ops: [], onFailure: 'continue' }).success).toBe(false);
    expect(WriteCapabilitiesSchema.parse(FULL_WRITE_CAPABILITIES)).toEqual(FULL_WRITE_CAPABILITIES);
    expect(QueryCapabilitiesSchema.parse(FULL_QUERY_CAPABILITIES)).toEqual(FULL_QUERY_CAPABILITIES);
  });
});

const writeFixture = WriteFixtureSchema.parse(JSON.parse(readFileSync(join(__dirname, 'fixtures/pushdown/write-cases.json'), 'utf8')));
const resolveFixture = ResolveFixtureSchema.parse(JSON.parse(readFileSync(join(__dirname, 'fixtures/pushdown/resolve-cases.json'), 'utf8')));
const byId = (rows: readonly EntityRow[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const kindsOnly = (outcomes: RowWriteOutcome[]) => outcomes.map((o) => (o.kind === 'failed' ? { kind: 'failed' } : o));

describe('runRowWrite / runRowWriteBatch over the shared write cases', () => {
  it('reads the recorded cases', () => {
    expect(writeFixture.cases).toHaveLength(32);
  });
  for (const c of writeFixture.cases) {
    it(c.name, () => {
      const result = c.batch
        ? runRowWriteBatch(writeFixture.rows, c.batch)
        : c.op
          ? ((r) => ({ rows: r.rows, outcomes: [r.outcome] }))(runRowWrite(writeFixture.rows, c.op))
          : null;
      expect(result).not.toBeNull();
      expect(kindsOnly(result?.outcomes ?? [])).toEqual(c.expect.outcomes);
      expect(byId(result?.rows ?? [])).toEqual(c.expect.rows);
    });
  }
  it('does not mutate its input', () => {
    const before = JSON.stringify(writeFixture.rows);
    runRowWriteBatch(writeFixture.rows, { ops: [{ kind: 'delete', entityType: 'Stock', id: 's1' }], onFailure: 'atomic' });
    expect(JSON.stringify(writeFixture.rows)).toBe(before);
  });
  it('upsert keeps the existing createdAt and replaces everything else; a new row is stored as given', () => {
    const stamped: EntityRow[] = [{ id: 'k', title: 'Old', stock: 3, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }];
    const replaced = runRowWrite(stamped, { kind: 'upsert', entityType: 'Stock', data: { id: 'k', title: 'New', createdAt: '2030-01-01T00:00:00.000Z' } });
    expect(replaced.outcome).toEqual({ kind: 'updated', row: { id: 'k', title: 'New', createdAt: '2026-01-01T00:00:00.000Z' } });
    expect(replaced.rows).toEqual([{ id: 'k', title: 'New', createdAt: '2026-01-01T00:00:00.000Z' }]);
    const control = runRowWrite(stamped, { kind: 'upsert', entityType: 'Stock', data: { id: 'n', title: 'Fresh', createdAt: '2030-01-01T00:00:00.000Z' } });
    expect(control.outcome.kind).toBe('created');
    expect(control.rows).toHaveLength(2);
  });
  it('control: an update with no guard carries no before', () => {
    const r = runRowWrite(writeFixture.rows, { kind: 'update', entityType: 'Stock', id: 's1', data: { stock: 1 } });
    expect(r.outcome.kind === 'updated' && r.outcome.before === undefined).toBe(true);
  });
});

describe('runRowIds and resolveRowSet over the shared resolve cases', () => {
  for (const c of resolveFixture.idCases) {
    it(c.name, () => {
      expect(runRowIds(resolveFixture.rows, c.query)).toEqual(c.expect);
    });
  }
  for (const c of resolveFixture.resolveCases) {
    it(c.name, () => {
      const patched = resolveFixture.rows.map((r) => {
        const change = c.set?.find((x) => x.id === r.id);
        return change ? { ...r, ...change.fields } : r;
      });
      const page = resolveRowSet([...patched, ...(c.add ?? [])], c.ref, c.policy);
      expect(page.rows.map((r) => r.id)).toEqual(c.expect.ids);
      expect(page.total).toBe(c.expect.total);
    });
  }
  it('ids are the ids of the rows the same query returns', () => {
    for (const c of resolveFixture.idCases) {
      expect(runRowIds(resolveFixture.rows, c.query).ids).toEqual(runRowQuery(resolveFixture.rows, c.query).rows.map((r) => r.id));
    }
  });
});

describe('nearestRows', () => {
  const row = (id: string, v?: number[] | null): EntityRow => (v === undefined ? { id } : { id, v });
  it('orders by descending cosine, ties by id, and keeps k', () => {
    const rows = [row('c', [0, 1]), row('b', [2, 0]), row('a', [1, 0]), row('d', [1, 1])];
    expect(nearestRows(rows, { field: 'v', vector: [1, 0], k: 3 }).map((r) => r.id)).toEqual(['a', 'b', 'd']);
    expect(nearestRows(rows, { field: 'v', vector: [1, 0], k: 10 }).map((r) => r.id)).toEqual(['a', 'b', 'd', 'c']);
  });
  it('skips absent, null and zero-norm rows and does not mutate its input', () => {
    const rows = [row('a'), row('b', null), row('z', [0, 0]), row('ok', [1, 1])];
    const copy = [...rows];
    expect(nearestRows(rows, { field: 'v', vector: [1, 0], k: 5 }).map((r) => r.id)).toEqual(['ok']);
    expect(rows).toEqual(copy);
  });
  it('fails on a dimension mismatch, a zero query, a non-vector field and a non-positive k, and answers the control', () => {
    const rows = [row('a', [1, 0, 0])];
    expect(() => nearestRows(rows, { field: 'v', vector: [1, 0], k: 1 })).toThrow('3 dimensions');
    expect(() => nearestRows(rows, { field: 'v', vector: [0, 0, 0], k: 1 })).toThrow('zero norm');
    expect(() => nearestRows([{ id: 'x', v: 'text' }], { field: 'v', vector: [1], k: 1 })).toThrow('not a [number]');
    expect(() => nearestRows([{ id: 'x', v: ['a'] }], { field: 'v', vector: [1], k: 1 })).toThrow('not a [number]');
    expect(() => nearestRows(rows, { field: 'v', vector: [1, 0, 0], k: 0 })).toThrow('positive integer');
    expect(nearestRows(rows, { field: 'v', vector: [1, 0, 0], k: 1 })).toHaveLength(1);
    expect(RowQuerySchema.safeParse({ nearest: { field: 'v', vector: [1], k: 0 } }).success).toBe(false);
    expect(RowQuerySchema.safeParse({ nearest: { field: 'v', vector: [1], k: 2 } }).success).toBe(true);
  });
});
