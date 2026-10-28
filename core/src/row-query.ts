/**
 * The one TypeScript definition of `RowPredicate` / `RowQuery` semantics. Every store that runs a
 * query in process (the memory adapter, the IndexedDB cursor pass, test oracles) goes through here;
 * stores that translate the query (SQL, Mango, Firestore) are tested against the same shared cases.
 */
import { z } from 'zod';
import { EntityRowSchema, FieldValueSchema, type EntityRow, type FieldValue } from './types/entity.js';
import type {
  QueryCapabilities,
  RowIdPage,
  RowPredicate,
  RowQuery,
  RowQueryPage,
  RowWriteBatch,
  RowWriteOp,
  RowWriteOutcome,
  WriteCapabilities,
  RowCommit,
} from './service-types.js';

const CompareOpSchema = z.enum(['==', '!=', '<', '<=', '>', '>=']);

export const RowPredicateSchema: z.ZodType<RowPredicate> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('compare'), field: z.string(), op: CompareOpSchema, value: FieldValueSchema }),
    z.object({ kind: z.literal('member'), field: z.string(), values: z.array(FieldValueSchema) }),
    z.object({ kind: z.literal('hasElement'), field: z.string(), value: FieldValueSchema }),
    z.object({ kind: z.literal('contains'), field: z.string(), text: z.string(), caseSensitive: z.boolean() }),
    z.object({ kind: z.literal('isNull'), field: z.string(), isNull: z.boolean() }),
    z.object({ kind: z.literal('all'), of: z.array(RowPredicateSchema) }),
    z.object({ kind: z.literal('any'), of: z.array(RowPredicateSchema) }),
    z.object({ kind: z.literal('not'), of: RowPredicateSchema }),
    z.object({ kind: z.literal('const'), value: z.boolean() }),
  ]),
);

export const RowQuerySchema: z.ZodType<RowQuery> = z.object({
  policy: RowPredicateSchema.optional(),
  filter: RowPredicateSchema.optional(),
  order: z.object({ field: z.string(), direction: z.enum(['asc', 'desc']) }).optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().nonnegative().optional(),
  total: z.enum(['exact', 'none']).optional(),
  nearest: z.object({ field: z.string(), vector: z.array(z.number()), k: z.number().int().positive() }).optional(),
});

export const RowIdPageSchema: z.ZodType<RowIdPage> = z.object({
  ids: z.array(z.string()),
  total: z.number().int().nonnegative(),
});

export const RowWriteOpSchema: z.ZodType<RowWriteOp> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), entityType: z.string(), data: EntityRowSchema }),
  z.object({ kind: z.literal('upsert'), entityType: z.string(), data: EntityRowSchema }),
  z.object({ kind: z.literal('update'), entityType: z.string(), id: z.string(), data: EntityRowSchema, guard: RowPredicateSchema.optional() }),
  z.object({ kind: z.literal('delete'), entityType: z.string(), id: z.string(), guard: RowPredicateSchema.optional() }),
  z.object({ kind: z.literal('rekey'), entityType: z.string(), id: z.string(), newId: z.string().min(1), guard: RowPredicateSchema.optional() }),
]);

export const RowWriteOutcomeSchema: z.ZodType<RowWriteOutcome> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('created'), row: EntityRowSchema }),
  z.object({ kind: z.literal('updated'), row: EntityRowSchema, before: EntityRowSchema.optional() }),
  z.object({ kind: z.literal('deleted'), before: EntityRowSchema.optional() }),
  z.object({ kind: z.literal('not-found') }),
  z.object({ kind: z.literal('duplicate-id') }),
  z.object({ kind: z.literal('refused') }),
  z.object({ kind: z.literal('failed'), message: z.string() }),
  z.object({ kind: z.literal('rolled-back') }),
]);

export const RowWriteBatchSchema: z.ZodType<RowWriteBatch> = z.object({
  ops: z.array(RowWriteOpSchema),
  onFailure: z.enum(['atomic', 'stop']),
});

const LeafKindSchema = z.enum(['compare', 'member', 'hasElement', 'contains', 'isNull']);
const CombinatorSchema = z.enum(['all', 'any', 'not']);
const RowOperatorSchema = z.enum(['==', '!=', '<', '<=', '>', '>=', 'member', 'hasElement', 'contains']);
const RowValueKindSchema = z.enum(['string', 'number', 'boolean', 'date', 'null']);

export const RowCommitSchema: z.ZodType<RowCommit> = z.object({
  entityType: z.string(),
  id: z.string(),
  expected: EntityRowSchema.nullable(),
  write: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('keep') }),
    z.object({ kind: z.literal('put'), row: EntityRowSchema }),
    z.object({ kind: z.literal('delete') }),
  ]),
});

export const QueryCapabilitiesSchema: z.ZodType<QueryCapabilities> = z.object({
  leaves: z.array(LeafKindSchema),
  combinators: z.array(CombinatorSchema),
  compareOps: z.array(CompareOpSchema),
  operatorValueKinds: z.array(z.object({ operator: RowOperatorSchema, valueKinds: z.array(RowValueKindSchema) })).optional(),
  orderableFields: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('every-field') }),
    z.object({ kind: z.literal('listed'), fields: z.array(z.string()) }),
  ]),
  window: z.boolean(),
  exactTotal: z.boolean(),
  idsOnly: z.boolean().optional(),
  nearest: z.boolean().optional(),
});

export const WriteCapabilitiesSchema: z.ZodType<WriteCapabilities> = z.object({
  guards: z.object({ leaves: z.array(LeafKindSchema), combinators: z.array(CombinatorSchema), compareOps: z.array(CompareOpSchema) }),
  conditional: z.boolean(),
  returnsRow: z.boolean(),
  stopRuns: z.boolean(),
  atomicBatch: z.boolean(),
  rekey: z.boolean().optional(),
  commitRows: z.boolean().optional(),
});

export const RowQueryPageSchema: z.ZodType<RowQueryPage> = z.object({
  rows: z.array(EntityRowSchema),
  total: z.number().int().nonnegative(),
});

type Comparable = string | number | boolean;

function isMissing(value: FieldValue | undefined): value is null | undefined {
  return value === null || value === undefined;
}

function comparable(value: FieldValue | undefined): value is Comparable {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function codePointOrder(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const cx = x[i].codePointAt(0) ?? 0;
    const cy = y[i].codePointAt(0) ?? 0;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/** Order of two present values of one kind (binary order for strings); null when the kinds differ. */
function orderValues(a: Comparable, b: Comparable): number | null {
  if (typeof a === 'string' && typeof b === 'string') return codePointOrder(a, b);
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  return null;
}

function sameValue(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  return a === b;
}

function compareLeaf(value: FieldValue | undefined, op: RowPredicate & { kind: 'compare' }): boolean {
  const target = op.value;
  if (isMissing(value)) return op.op === '!=' && !isMissing(target);
  switch (op.op) {
    case '==': return sameValue(value, target);
    case '!=': return !sameValue(value, target);
    default: {
      if (!comparable(value) || !comparable(target)) return false;
      const c = orderValues(value, target);
      if (c === null) return false;
      if (op.op === '<') return c < 0;
      if (op.op === '<=') return c <= 0;
      if (op.op === '>') return c > 0;
      return c >= 0;
    }
  }
}

/** Full Unicode case folding as `toUpperCase` then `toLowerCase` gives it: `ß` = `SS` = `ss`, `ς` = `σ`. */
function foldCase(text: string): string {
  return text.toUpperCase().toLowerCase();
}

type MemberLookup = Set<FieldValue>;

// A member list is scanned once per predicate, not once per row.
const memberLookups = new WeakMap<RowPredicate & { kind: 'member' }, MemberLookup>();

function memberLookup(predicate: RowPredicate & { kind: 'member' }): MemberLookup {
  const cached = memberLookups.get(predicate);
  if (cached !== undefined) return cached;
  const lookup: MemberLookup = new Set(predicate.values);
  memberLookups.set(predicate, lookup);
  return lookup;
}

export function rowMatchesPredicate(row: EntityRow, predicate: RowPredicate): boolean {
  switch (predicate.kind) {
    case 'const': return predicate.value;
    case 'all': return predicate.of.every((p) => rowMatchesPredicate(row, p));
    case 'any': return predicate.of.some((p) => rowMatchesPredicate(row, p));
    case 'not': return !rowMatchesPredicate(row, predicate.of);
    case 'compare': return compareLeaf(row[predicate.field], predicate);
    case 'isNull': return isMissing(row[predicate.field]) === predicate.isNull;
    case 'member': {
      const value = row[predicate.field];
      if (isMissing(value)) return false;
      const lookup = memberLookup(predicate);
      return !Number.isNaN(value) && lookup.has(value);
    }
    case 'hasElement': {
      const value = row[predicate.field];
      return Array.isArray(value) && value.some((v) => sameValue(v, predicate.value));
    }
    case 'contains': {
      const value = row[predicate.field];
      if (typeof value !== 'string') return false;
      return predicate.caseSensitive
        ? value.includes(predicate.text)
        : foldCase(value).includes(foldCase(predicate.text));
    }
  }
}

export interface RowWriteResult {
  rows: EntityRow[];
  outcome: RowWriteOutcome;
}

function rowIdOf(row: EntityRow): string | null {
  return typeof row.id === 'string' ? row.id : null;
}

/** The reference run of one write over a full row set; the input is not mutated. */
export function runRowWrite(rows: readonly EntityRow[], op: RowWriteOp): RowWriteResult {
  if (op.kind === 'rekey') return { rows: [...rows], outcome: { kind: 'failed', message: 'rekey is unsupported by this store' } };
  if (op.kind === 'create') {
    const id = rowIdOf(op.data);
    if (id === null) return { rows: [...rows], outcome: { kind: 'failed', message: 'create needs a string id' } };
    if (rows.some((r) => r.id === id)) return { rows: [...rows], outcome: { kind: 'duplicate-id' } };
    const row: EntityRow = { ...op.data };
    return { rows: [...rows, row], outcome: { kind: 'created', row } };
  }
  if (op.kind === 'upsert') {
    const id = rowIdOf(op.data);
    if (id === null) return { rows: [...rows], outcome: { kind: 'failed', message: 'upsert needs a string id' } };
    const index = rows.findIndex((r) => r.id === id);
    if (index < 0) {
      const row: EntityRow = { ...op.data };
      return { rows: [...rows, row], outcome: { kind: 'created', row } };
    }
    const kept = rows[index].createdAt;
    const row: EntityRow = kept === undefined ? { ...op.data } : { ...op.data, createdAt: kept };
    return { rows: rows.map((r, i) => (i === index ? row : r)), outcome: { kind: 'updated', row } };
  }
  const index = rows.findIndex((r) => r.id === op.id);
  if (index < 0) return { rows: [...rows], outcome: { kind: 'not-found' } };
  const before = rows[index];
  if (op.guard !== undefined && !rowMatchesPredicate(before, op.guard)) return { rows: [...rows], outcome: { kind: 'refused' } };
  const guarded = op.guard !== undefined ? { before } : {};
  if (op.kind === 'delete') {
    return { rows: rows.filter((_, i) => i !== index), outcome: { kind: 'deleted', ...guarded } };
  }
  const row: EntityRow = { ...before, ...op.data, id: op.id };
  return { rows: rows.map((r, i) => (i === index ? row : r)), outcome: { kind: 'updated', row, ...guarded } };
}

function applied(outcome: RowWriteOutcome): boolean {
  return outcome.kind === 'created' || outcome.kind === 'updated' || outcome.kind === 'deleted';
}

export interface RowWriteBatchResult {
  rows: EntityRow[];
  outcomes: RowWriteOutcome[];
}

/** Capabilities of a store that runs every query form, vector search included; a store that cannot rank by similarity overrides `nearest: false`. */
const FULL_QUERY_CAPABILITIES: QueryCapabilities = {
  leaves: ['compare', 'member', 'hasElement', 'contains', 'isNull'],
  combinators: ['all', 'any', 'not'],
  compareOps: ['==', '!=', '<', '<=', '>', '>='],
  orderableFields: { kind: 'every-field' },
  window: true,
  exactTotal: true,
  nearest: true,
};

/** Capabilities for conditional writes, ordered runs and transactional batches; rekey requires an explicit declaration. */
export const FULL_WRITE_CAPABILITIES: WriteCapabilities = {
  guards: { leaves: FULL_QUERY_CAPABILITIES.leaves, combinators: FULL_QUERY_CAPABILITIES.combinators, compareOps: FULL_QUERY_CAPABILITIES.compareOps },
  conditional: true,
  returnsRow: true,
  stopRuns: true,
  atomicBatch: true,
};

export type QueryUnsupportedReason =
  | 'leaf-unsupported'
  | 'combinator-unsupported'
  | 'value-kind-unsupported'
  | 'order-field'
  | 'window'
  | 'exact-total'
  | 'nearest';

export type QueryDeclinedReason = QueryUnsupportedReason | 'ids-only';

/** What a store throws when it declines a pushed-down query it cannot run; nothing was read. */
export class QueryDeclinedError extends Error {
  readonly reason: QueryDeclinedReason;

  constructor(reason: QueryDeclinedReason, message?: string) {
    super(message ?? `query declined: ${reason}`);
    this.name = 'QueryDeclinedError';
    this.reason = reason;
  }
}

export type WriteDeclinedReason = 'atomic-batch' | 'no-transaction' | 'guard-value-kind';

/** What a store throws when it declines a pushed-down write shape it did not declare; nothing was written. */
export class WriteDeclinedError extends Error {
  readonly reason: WriteDeclinedReason;

  constructor(reason: WriteDeclinedReason, message?: string) {
    super(message ?? `write declined: ${reason}`);
    this.name = 'WriteDeclinedError';
    this.reason = reason;
  }
}
