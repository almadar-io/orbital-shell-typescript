/**
 * The one TypeScript definition of `RowPredicate` / `RowQuery` semantics. Every store that runs a
 * query in process (the memory adapter, the IndexedDB cursor pass, test oracles) goes through here;
 * stores that translate the query (SQL, Mango, Firestore) are tested against the same shared cases.
 */
import { z } from 'zod';
import { EntityRowSchema, FieldValueSchema, type EntityRow, type FieldValue } from './types/entity.js';
import type {
  OperatorValueKinds,
  QueryCapabilities,
  RowIdPage,
  RowNearest,
  RowOperator,
  RowOrder,
  RowPredicate,
  RowQuery,
  RowQueryPage,
  RowValueKind,
  RowWriteBatch,
  RowWriteOp,
  RowWriteOutcome,
  WriteCapabilities,
} from './service-types.js';
import type { RowSetRef } from './types/row-set.js';

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
});

export const RowQueryPageSchema: z.ZodType<RowQueryPage> = z.object({
  rows: z.array(EntityRowSchema),
  total: z.number().int().nonnegative(),
});

type Comparable = string | number | boolean | Date;

function isMissing(value: FieldValue | undefined): value is null | undefined {
  return value === null || value === undefined;
}

function comparable(value: FieldValue | undefined): value is Comparable {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Date;
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
  if (a instanceof Date && b instanceof Date) {
    const x = a.getTime();
    const y = b.getTime();
    return x === y ? 0 : x < y ? -1 : 1;
  }
  return null;
}

function sameValue(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
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

interface MemberLookup {
  plain: Set<FieldValue>;
  times: Set<number>;
}

// A member list is scanned once per predicate, not once per row.
const memberLookups = new WeakMap<RowPredicate & { kind: 'member' }, MemberLookup>();

function memberLookup(predicate: RowPredicate & { kind: 'member' }): MemberLookup {
  const cached = memberLookups.get(predicate);
  if (cached !== undefined) return cached;
  const lookup: MemberLookup = { plain: new Set(), times: new Set() };
  for (const v of predicate.values) {
    if (v instanceof Date) lookup.times.add(v.getTime());
    else lookup.plain.add(v);
  }
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
      if (value instanceof Date) return lookup.times.has(value.getTime());
      return !Number.isNaN(value) && lookup.plain.has(value);
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

/** Rank of a present value's kind, so a column of mixed kinds still has one total order (`orbital-core` `kind_rank`). */
function kindRank(value: Comparable | FieldValue): number {
  if (typeof value === 'boolean') return 0;
  if (typeof value === 'number') return 1;
  if (typeof value === 'string') return 2;
  return 3;
}

/** Comparator for one sort key: missing and null last in both directions, values of different kinds by kind rank, no tie-break. */
export function compareByField(field: string, direction: RowOrder['direction']): (a: EntityRow, b: EntityRow) => number {
  return (a, b) => {
    const x = a[field];
    const y = b[field];
    const xMissing = isMissing(x);
    const yMissing = isMissing(y);
    if (xMissing || yMissing) return xMissing === yMissing ? 0 : xMissing ? 1 : -1;
    const c = comparable(x) && comparable(y) ? orderValues(x, y) : null;
    const ordered = c ?? kindRank(x) - kindRank(y);
    return direction === 'asc' ? ordered : -ordered;
  };
}

/**
 * The order of a query with no authored `order` (EXEC-FETCH-1): the row stamp `createdAt` ascending, a row
 * without one last, ties by `id` ascending. Every store and both execution paths answer an unordered query this way.
 */
export const DEFAULT_ROW_ORDER: RowOrder = { field: 'createdAt', direction: 'asc' };

/** The order a store must apply to `query`: the authored one, else {@link DEFAULT_ROW_ORDER}. */
export function effectiveRowOrder(query: Pick<RowQuery, 'order'>): RowOrder {
  return query.order ?? DEFAULT_ROW_ORDER;
}

/** Rows ordered by `order` (the default order when absent), ties by `id` ascending; the input is not mutated. */
export function orderRows(rows: readonly EntityRow[], order: RowOrder | undefined): EntityRow[] {
  const byId = compareByField('id', 'asc');
  const effective = order ?? DEFAULT_ROW_ORDER;
  const byKey = compareByField(effective.field, effective.direction);
  return [...rows].sort((a, b) => byKey(a, b) || byId(a, b));
}

/** What a `nearest` query throws when its rows cannot answer it: a zero-norm query, a non-positive `k`, a stored vector that is not a `[number]` of the query's length. */
export class NearestQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NearestQueryError';
  }
}

/**
 * The one `nearest` selection (EXEC-FETCH-2; `orbital-core` `nearest_rows` is its twin): `rows` are already admitted by
 * the policy and filter. Cosine similarity `dot / (|q| * |r|)`, descending, ties by `id` ascending, the first `k`.
 * A row whose field is absent, null or of zero norm is skipped.
 */
export function nearestRows(rows: readonly EntityRow[], nearest: RowNearest): EntityRow[] {
  if (!Number.isInteger(nearest.k) || nearest.k < 1) throw new NearestQueryError('nearest: k must be a positive integer');
  const queryNorm = Math.sqrt(nearest.vector.reduce((sum, x) => sum + x * x, 0));
  if (queryNorm === 0) throw new NearestQueryError('nearest: the query vector has zero norm');
  const scored: { similarity: number; id: string; row: EntityRow }[] = [];
  for (const row of rows) {
    const stored = row[nearest.field];
    if (stored === null || stored === undefined) continue;
    const id = String(row.id ?? '');
    if (!Array.isArray(stored)) throw new NearestQueryError(`nearest: field \`${nearest.field}\` of row \`${id}\` is not a [number]`);
    if (stored.length !== nearest.vector.length) {
      throw new NearestQueryError(`nearest: field \`${nearest.field}\` of row \`${id}\` has ${stored.length} dimensions, the query has ${nearest.vector.length}`);
    }
    let dot = 0;
    let sumSquares = 0;
    for (let i = 0; i < stored.length; i++) {
      const x = stored[i];
      if (typeof x !== 'number') throw new NearestQueryError(`nearest: field \`${nearest.field}\` of row \`${id}\` is not a [number]`);
      dot += x * nearest.vector[i];
      sumSquares += x * x;
    }
    const rowNorm = Math.sqrt(sumSquares);
    if (rowNorm === 0) continue;
    scored.push({ similarity: dot / (queryNorm * rowNorm), id, row });
  }
  scored.sort((a, b) => (a.similarity === b.similarity ? codePointOrder(a.id, b.id) : b.similarity - a.similarity));
  return scored.slice(0, nearest.k).map((s) => s.row);
}

/** The reference run of a `RowQuery` over a full row set. */
export function runRowQuery(rows: readonly EntityRow[], query: RowQuery): RowQueryPage {
  const matched = rows.filter(
    (row) =>
      (query.policy === undefined || rowMatchesPredicate(row, query.policy)) &&
      (query.filter === undefined || rowMatchesPredicate(row, query.filter)),
  );
  if (query.nearest !== undefined) {
    const ranked = nearestRows(matched, query.nearest);
    return { rows: ranked, total: ranked.length };
  }
  const ordered = orderRows(matched, query.order);
  const start = query.offset ?? 0;
  const end = query.limit === undefined ? undefined : start + query.limit;
  const window = ordered.slice(start, end);
  return { rows: window, total: query.total === 'none' ? window.length : ordered.length };
}

/** The reference run of a `RowQuery` that wants ids only: the same window as `runRowQuery`. */
export function runRowIds(rows: readonly EntityRow[], query: RowQuery): RowIdPage {
  const page = runRowQuery(rows, query);
  return { ids: page.rows.map((r) => String(r.id)), total: page.total };
}

/**
 * A row set by reference, resolved against the current rows: ids in `ref.ids` order that still match
 * the ref's query (and `policy`, the current viewer's @read, when given); `total` is a true re-count
 * of that query's matches, ignoring its order and window.
 */
export function resolveRowSet(rows: readonly EntityRow[], ref: RowSetRef, policy?: RowPredicate): RowQueryPage {
  const matching = runRowQuery(rows, {
    policy: policy === undefined || ref.query.policy === undefined ? (policy ?? ref.query.policy) : { kind: 'all', of: [ref.query.policy, policy] },
    filter: ref.query.filter,
  });
  const byId = new Map<string, EntityRow>();
  for (const row of matching.rows) byId.set(String(row.id), row);
  const resolved: EntityRow[] = [];
  for (const id of ref.ids) {
    const row = byId.get(id);
    if (row !== undefined) resolved.push(row);
  }
  return { rows: resolved, total: matching.total };
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

/** The reference run of a batch: ops in order, each seeing the earlier ones; `atomic` and `stop` as `RowWriteFailureMode` says. */
export function runRowWriteBatch(rows: readonly EntityRow[], batch: RowWriteBatch): RowWriteBatchResult {
  let table: EntityRow[] = [...rows];
  const outcomes: RowWriteOutcome[] = [];
  for (const op of batch.ops) {
    const result = runRowWrite(table, op);
    outcomes.push(result.outcome);
    if (!applied(result.outcome)) {
      if (batch.onFailure === 'atomic') {
        const undone: RowWriteOutcome[] = outcomes.slice(0, -1).map(() => ({ kind: 'rolled-back' }));
        return { rows: [...rows], outcomes: [...undone, result.outcome] };
      }
      return { rows: table, outcomes };
    }
    table = result.rows;
  }
  return { rows: table, outcomes };
}

/** Capabilities of a store that runs every query form, vector search included; a store that cannot rank by similarity overrides `nearest: false`. */
export const FULL_QUERY_CAPABILITIES: QueryCapabilities = {
  leaves: ['compare', 'member', 'hasElement', 'contains', 'isNull'],
  combinators: ['all', 'any', 'not'],
  compareOps: ['==', '!=', '<', '<=', '>', '>='],
  orderableFields: { kind: 'every-field' },
  window: true,
  exactTotal: true,
  nearest: true,
};

/** Capabilities of a store that runs every write form: conditional, ordered runs and transactional batches. */
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

function valueKindOf(value: FieldValue): RowValueKind | null {
  if (value === null) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Date) return 'date';
  return null;
}

function valueKindsAccepted(restrictions: readonly OperatorValueKinds[] | undefined, operator: RowOperator): readonly RowValueKind[] | null {
  const found = restrictions?.find((r) => r.operator === operator);
  return found ? found.valueKinds : null;
}

function valueKindUnsupported(capabilities: QueryCapabilities, predicate: RowPredicate): boolean {
  const restrictions = capabilities.operatorValueKinds;
  if (restrictions === undefined) return false;
  const refuses = (operator: RowOperator, values: readonly FieldValue[]): boolean => {
    const accepted = valueKindsAccepted(restrictions, operator);
    if (accepted === null) return false;
    return values.some((v) => {
      const kind = valueKindOf(v);
      return kind !== null && !accepted.includes(kind);
    });
  };
  switch (predicate.kind) {
    case 'const':
    case 'isNull':
      return false;
    case 'compare': return refuses(predicate.op, [predicate.value]);
    case 'member': return refuses('member', predicate.values);
    case 'hasElement': return refuses('hasElement', [predicate.value]);
    case 'contains': return refuses('contains', [predicate.text]);
    case 'all':
    case 'any': return predicate.of.some((p) => valueKindUnsupported(capabilities, p));
    case 'not': return valueKindUnsupported(capabilities, predicate.of);
  }
}

function predicateUnsupported(capabilities: QueryCapabilities, predicate: RowPredicate): QueryUnsupportedReason | null {
  switch (predicate.kind) {
    case 'const': return null;
    case 'compare':
      return capabilities.leaves.includes('compare') && capabilities.compareOps.includes(predicate.op) ? null : 'leaf-unsupported';
    case 'member':
    case 'hasElement':
    case 'contains':
    case 'isNull':
      return capabilities.leaves.includes(predicate.kind) ? null : 'leaf-unsupported';
    case 'all':
    case 'any': {
      if (!capabilities.combinators.includes(predicate.kind)) return 'combinator-unsupported';
      for (const child of predicate.of) {
        const reason = predicateUnsupported(capabilities, child);
        if (reason) return reason;
      }
      return null;
    }
    case 'not':
      return capabilities.combinators.includes('not') ? predicateUnsupported(capabilities, predicate.of) : 'combinator-unsupported';
  }
}

/**
 * Why a host with `capabilities` cannot run `query` as a push-down, or null when it can. The first
 * failing check wins: leaves, combinators, value kinds, order field (the default order's `createdAt` when none is authored),
 * window, exact total (not needed for `total: none`). A `nearest` query needs only the `nearest` capability
 * beyond the predicates, since it has no order, window or count of its own.
 */
export function queryUnsupportedReason(capabilities: QueryCapabilities, query: RowQuery): QueryUnsupportedReason | null {
  const used: RowPredicate[] = [];
  if (query.policy) used.push(query.policy);
  if (query.filter) used.push(query.filter);
  // leaf checks across both predicates first, then combinators: a leaf failure outranks a combinator one
  for (const predicate of used) {
    const reason = leafUnsupported(capabilities, predicate);
    if (reason) return reason;
  }
  for (const predicate of used) {
    const reason = predicateUnsupported(capabilities, predicate);
    if (reason) return reason;
  }
  for (const predicate of used) {
    if (valueKindUnsupported(capabilities, predicate)) return 'value-kind-unsupported';
  }
  if (query.nearest !== undefined) return capabilities.nearest === true ? null : 'nearest';
  const order = effectiveRowOrder(query);
  if (capabilities.orderableFields.kind === 'listed' && !capabilities.orderableFields.fields.includes(order.field)) {
    return 'order-field';
  }
  if ((query.offset !== undefined || query.limit !== undefined) && !capabilities.window) return 'window';
  if (!capabilities.exactTotal && query.total !== 'none') return 'exact-total';
  return null;
}

function leafUnsupported(capabilities: QueryCapabilities, predicate: RowPredicate): 'leaf-unsupported' | null {
  switch (predicate.kind) {
    case 'all':
    case 'any':
      for (const child of predicate.of) {
        if (leafUnsupported(capabilities, child)) return 'leaf-unsupported';
      }
      return null;
    case 'not': return leafUnsupported(capabilities, predicate.of);
    default: return predicateUnsupported(capabilities, predicate) === null ? null : 'leaf-unsupported';
  }
}
