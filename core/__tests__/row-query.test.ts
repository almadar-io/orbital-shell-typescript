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
  FULL_WRITE_CAPABILITIES,
  QueryCapabilitiesSchema,
  QueryDeclinedError,
  WriteDeclinedError,
  RowWriteBatchSchema,
  RowWriteOpSchema,
  RowWriteOutcomeSchema,
  WriteCapabilitiesSchema,
  rowMatchesPredicate,
  runRowWrite,
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
      expect: z.object({ outcomes: z.array(z.record(z.string(), z.union([z.string(), EntityRowSchema]))), rows: z.array(EntityRowSchema) }),
    }),
  ),
});


describe('rowMatchesPredicate edge cases', () => {
  const row: EntityRow = { id: 'x', n: 0, s: 'Ab', nil: null, tags: ['a'], d: new Date(5).toISOString() };
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
    expect(m({ kind: 'compare', field: 'd', op: '>=', value: new Date(5).toISOString() })).toBe(true);
    expect(m({ kind: 'compare', field: 'd', op: '==', value: new Date(5).toISOString() })).toBe(true);
  });
  it('member and hasElement need a present value', () => {
    expect(m({ kind: 'member', field: 's', values: ['Ab'] })).toBe(true);
    expect(m({ kind: 'member', field: 'nil', values: [null] })).toBe(false);
    expect(m({ kind: 'hasElement', field: 'tags', value: 'a' })).toBe(true);
    expect(m({ kind: 'hasElement', field: 's', value: 'A' })).toBe(false);
  });
  it('member matches an ISO date by its text and never NaN, a number never a date', () => {
    const r: EntityRow = { id: 'y', d: new Date(5).toISOString(), nan: Number.NaN, z: -0, n: 5 };
    expect(rowMatchesPredicate(r, { kind: 'member', field: 'd', values: [new Date(5).toISOString()] })).toBe(true);
    expect(rowMatchesPredicate(r, { kind: 'member', field: 'd', values: [5] })).toBe(false);
    expect(rowMatchesPredicate(r, { kind: 'member', field: 'n', values: [new Date(5).toISOString()] })).toBe(false);
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
  });
});

const writeFixture = WriteFixtureSchema.parse(JSON.parse(readFileSync(join(__dirname, 'fixtures/pushdown/write-cases.json'), 'utf8')));
const byId = (rows: readonly EntityRow[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const kindsOnly = (outcomes: RowWriteOutcome[]) => outcomes.map((o) => (o.kind === 'failed' ? { kind: 'failed' } : o));

describe('runRowWrite over the shared single-op write cases', () => {
  it('reads the recorded cases', () => {
    expect(writeFixture.cases).toHaveLength(32);
  });
  for (const c of writeFixture.cases.filter((x) => x.op !== undefined)) {
    it(c.name, () => {
      const result = c.op ? runRowWrite(writeFixture.rows, c.op) : null;
      expect(result).not.toBeNull();
      expect(kindsOnly(result === null ? [] : [result.outcome])).toEqual(c.expect.outcomes);
      expect(byId(result?.rows ?? [])).toEqual(c.expect.rows);
    });
  }
  it('does not mutate its input', () => {
    const before = JSON.stringify(writeFixture.rows);
    runRowWrite(writeFixture.rows, { kind: 'delete', entityType: 'Stock', id: 's1' });
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



describe('native rekey contract and unsupported reference writes', () => {
  const rekey = { kind: 'rekey', entityType: 'Task', id: 'a', newId: 'b', guard: { kind: 'const', value: true } };
  const rows: EntityRow[] = [{ id: 'a', title: 'source', createdAt: 'source-time' }, { id: 'b', title: 'destination', createdAt: 'destination-time' }];

  it('accepts a nonempty destination and retains the native capability flag', () => {
    expect(RowWriteOpSchema.parse(rekey)).toEqual(rekey);
    expect(RowWriteBatchSchema.parse({ ops: [rekey], onFailure: 'atomic' })).toEqual({ ops: [rekey], onFailure: 'atomic' });
    expect(WriteCapabilitiesSchema.parse({ ...FULL_WRITE_CAPABILITIES, rekey: true })).toEqual({ ...FULL_WRITE_CAPABILITIES, rekey: true });
    expect(WriteCapabilitiesSchema.parse({ ...FULL_WRITE_CAPABILITIES, rekey: false })).toEqual({ ...FULL_WRITE_CAPABILITIES, rekey: false });
    expect(WriteCapabilitiesSchema.parse(FULL_WRITE_CAPABILITIES)).toEqual(FULL_WRITE_CAPABILITIES);
    expect(FULL_WRITE_CAPABILITIES).not.toHaveProperty('rekey');
  });

  it('rejects missing, empty and non-string destinations', () => {
    for (const newId of [undefined, '', 12, null, [], {}]) {
      expect(RowWriteOpSchema.safeParse({ ...rekey, newId }).success).toBe(false);
    }
  });

  it('refuses rekey without implementing collision, lookup or guard semantics', () => {
    for (const id of ['a', 'missing']) {
      for (const value of [true, false]) {
        const op = RowWriteOpSchema.parse({ ...rekey, id, guard: { kind: 'const', value } });
        expect(runRowWrite(rows, op)).toEqual({ rows, outcome: { kind: 'failed', message: 'rekey is unsupported by this store' } });
      }
    }
    expect(rows).toEqual([{ id: 'a', title: 'source', createdAt: 'source-time' }, { id: 'b', title: 'destination', createdAt: 'destination-time' }]);
  });

});
