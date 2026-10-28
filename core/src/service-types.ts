/**
 * Service Contract Types
 *
 * Formalizes the two public surfaces of an Almadar service:
 * 1. Call-Service Contract — what the .orb schema can invoke on the TypeScript package
 * 2. Event Contract — what events enter/leave the service
 *
 * Plus internal-but-standardized patterns:
 * 3. StoreContract — database abstraction boundary
 * 4. LazyService — singleton lifecycle pattern
 *
 * @packageDocumentation
 */

import type { EventPayload, EventPayloadValue, LogMeta } from './types/expression.js';
import type { ServiceParams } from './types/service.js';
import type { EntityRow, FieldValue } from './types/entity.js';

// ============================================================================
// Service Action Names (generated from services-registry.json)
// ============================================================================

/**
 * All known service action names across all contracts.
 * Kept in sync with `tools/almadar-service-sync/services-registry.json`.
 *
 * Persist operations are listed separately because they also appear
 * as `EffectResult.action` for persist effects.
 */
export type PersistActionName =
  | "create"
  | "update"
  | "delete"
  | "list"
  | "query";

/**
 * Union of all service action names across the registered service contracts.
 */
export type ServiceActionName =
  | PersistActionName
  // Data service
  | "get"
  | "getById"
  | "set"
  | "remove"
  | "size"
  // LLM
  | "generate"
  | "classify"
  | "extract"
  | "summarize"
  // Messaging
  | "send"
  | "sendMessage"
  | "sendSMS"
  | "sendWhatsApp"
  // Auth / Identity
  | "authorize"
  | "revoke"
  | "token"
  | "refresh"
  | "userinfo"
  | "register"
  // Git / VCS
  | "cloneRepo"
  | "commit"
  | "createBranch"
  | "createPR"
  | "getPRComments"
  | "pull"
  | "push"
  // CI / Build
  | "build"
  | "compile"
  | "compileSchema"
  | "run"
  | "validate"
  | "validateSchema"
  | "publish"
  // Queue / Jobs
  | "enqueue"
  | "dequeue"
  | "cancel"
  // Storage / Assets
  | "upload"
  | "download"
  | "getSignedUrl"
  // Search / Issues
  | "search"
  | "getIssue"
  | "listIssues"
  // Agent / Generation
  | "generateAll"
  | "generateDomainLanguage"
  | "generateFix"
  | "generateOrbitals"
  | "cancelGeneration"
  | "getGenerationHistory"
  | "recordGeneration"
  // Telemetry / Metrics
  | "startSpan"
  | "endSpan"
  | "getSpan"
  | "recordMetric"
  | "getMetrics"
  | "increment"
  | "logs"
  // Events / Channels
  | "addEvent"
  | "emit"
  | "findEmitters"
  | "findListeners"
  | "getListenerCounts"
  | "getChannel"
  | "subscribe"
  // User / Preferences
  | "getUserPreferences"
  | "updateUserPreferences"
  | "getThreadHistory"
  // Migration / Import
  | "listDocuments"
  | "fetchDocument"
  // Media
  | "getVideo"
  // Payments
  | "createPaymentIntent"
  | "confirmPayment"
  | "refund"
  // Lifecycle
  | "complete"
  | "fail"
  | "expire"
  | "resume"
  | "status"
  | "stop"
  | "lock"
  | "unlock"
  | "clear";

// ============================================================================
// Call-Service Contract
// ============================================================================

/**
 * Action definition for a service contract.
 *
 * - `params` is bus-payload-shaped (`ServiceParams`): JSON-serializable
 *   key/value bag with optional nesting. Service contracts override this
 *   with stricter shapes via the generic position on `ServiceContract`.
 *
 * - `result` is JSON-serializable too (`EventPayloadValue`): a primitive,
 *   `null`/`undefined`, an array of values, or an `EventPayload` object.
 *   This is the same recursive shape the bus accepts when an effect's
 *   `success` event fires with the call-service result, so no boundary
 *   widening is needed when the runtime forwards the value.
 */
export interface ServiceAction {
  params: ServiceParams;
  result: EventPayloadValue;
}

/**
 * What `["call-service", "name", "action", {...}]` actually calls at runtime.
 * Each service defines its action map as a Record<string, ServiceAction>.
 *
 * @example
 * ```typescript
 * type LLMActions = {
 *   generate: {
 *     params: { userPrompt: string; model: string; maxTokens: number };
 *     result: { content: string; tokensUsed: number; latencyMs: number };
 *   };
 * };
 *
 * class LLMService implements ServiceContract<LLMActions> {
 *   async execute(action, params) { ... }
 * }
 * ```
 */
export interface ServiceContract<
  Actions extends Record<string, ServiceAction>,
> {
  execute<A extends keyof Actions & string>(
    action: A,
    params: Actions[A]["params"],
  ): Promise<Actions[A]["result"]>;
}

// ============================================================================
// Event Contract
// ============================================================================

/**
 * Event contract — what events the service emits/listens with typed payloads.
 * Derived from the `.orb` schema's `emits` and `listens` declarations.
 *
 * @example
 * ```typescript
 * type LLMEventMap = {
 *   AGENT_LLM_REQUEST: { requestId: string; prompt: string };
 *   LLM_RESPONSE: { requestId: string; content: string; tokensUsed: number };
 *   LLM_ERROR: { requestId: string; error: string };
 * };
 *
 * const events: ServiceEvents<LLMEventMap> = getEventBus();
 * events.emit('LLM_RESPONSE', { requestId: '1', content: '...', tokensUsed: 42 });
 * ```
 */
export interface ServiceEvents<
  EventMap extends Record<string, EventPayload>,
> {
  emit<E extends keyof EventMap & string>(
    event: E,
    payload: EventMap[E],
  ): void;
  on<E extends keyof EventMap & string>(
    event: E,
    handler: (payload: EventMap[E]) => void,
  ): () => void;
}

/**
 * Create a typed view of an untyped EventBus. Wraps the raw EventBus
 * with compile-time type checking while keeping runtime behavior identical.
 *
 * @example
 * ```typescript
 * type LLMEventMap = {
 *   LLM_RESPONSE: { requestId: string; content: string };
 *   LLM_ERROR: { requestId: string; error: string };
 * };
 *
 * const typedBus = createTypedEventBus<LLMEventMap>(getServerEventBus());
 * typedBus.emit('LLM_RESPONSE', { requestId: '1', content: '...' }); // type-safe
 * typedBus.on('LLM_ERROR', (payload) => { payload.error; }); // payload is typed
 * ```
 */
/**
 * Creates a typed event bus from an untyped bus implementation.
 * 
 * This wrapper adds TypeScript type safety to event emission and listening.
 * The generic `EventMap` defines the shape of all events and their payloads.
 * 
 * @template EventMap - Type mapping event names to their payload types
 * @param {Object} bus - Untyped event bus implementation
 * @param {Function} bus.emit - Function to emit events
 * @param {Function} bus.on - Function to listen to events
 * @returns {ServiceEvents<EventMap>} Typed event bus interface
 * 
 * @example
 * interface MyEvents {
 *   'user.created': { id: string; name: string };
 *   'user.deleted': { id: string };
 * }
 * 
 * const typedBus = createTypedEventBus<MyEvents>(rawBus);
 * typedBus.emit('user.created', { id: '123', name: 'Alice' });
 */
export function createTypedEventBus<
  EventMap extends Record<string, EventPayload>,
>(bus: {
  emit(event: string, payload?: unknown, meta?: LogMeta): void;
  on(event: string, handler: (payload: unknown, meta?: LogMeta) => void): () => void;
}): ServiceEvents<EventMap> {
  return {
    emit<E extends keyof EventMap & string>(event: E, payload: EventMap[E]): void {
      bus.emit(event, payload);
    },
    on<E extends keyof EventMap & string>(
      event: E,
      handler: (payload: EventMap[E]) => void,
    ): () => void {
      return bus.on(event, handler as (payload: unknown) => void);
    },
  };
}

// ============================================================================
// Store Contract
// ============================================================================

/** Filter operator for store queries. */
export type StoreFilterOp =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "in"
  | "not-in"
  | "contains"
  | "array-contains"
  | "array-contains-any";

/** A single filter clause for store queries. */
export interface StoreFilter<T> {
  field: keyof T & string;
  op: StoreFilterOp;
  value: FieldValue | undefined;
}

/** One page of rows from a store: filters, then search, then sort, then the page. */
export type RowPageRequest<T> = {
  /** 1-indexed. */
  page: number;
  pageSize: number;
  filters?: readonly StoreFilter<T>[];
  /** Case-insensitive substring match over `searchFields` (every field when absent). */
  search?: string;
  searchFields?: readonly string[];
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

export type RowPage<T> = {
  rows: T[];
  /** Rows matching the filters and search, across all pages. */
  total: number;
};

/** The comparison members of `StoreFilterOp`. */
export type RowCompareOp = Extract<StoreFilterOp, "==" | "!=" | "<" | "<=" | ">" | ">=">;

/**
 * A row predicate with two-valued logic: a missing or null field satisfies only `!=` against a
 * non-null value and `isNull: true`, and fails every other leaf, so `not` of a failing leaf holds.
 * Leaves reuse the `StoreFilterOp` meanings: `member` is `in`, `hasElement` is `array-contains`,
 * `contains` is a substring test.
 */
export type RowPredicate =
  | { kind: "compare"; field: string; op: RowCompareOp; value: FieldValue }
  | { kind: "member"; field: string; values: FieldValue[] }
  | { kind: "hasElement"; field: string; value: FieldValue }
  | { kind: "contains"; field: string; text: string; caseSensitive: boolean }
  | { kind: "isNull"; field: string; isNull: boolean }
  | { kind: "all"; of: RowPredicate[] }
  | { kind: "any"; of: RowPredicate[] }
  | { kind: "not"; of: RowPredicate }
  | { kind: "const"; value: boolean };

/** One sort key. Missing and null values sort last in both directions; ties break by `id` ascending. A query with no `order` is ordered by `createdAt` ascending, then `id` (EXEC-FETCH-1). */
export type RowOrder = {
  field: string;
  direction: "asc" | "desc";
};

/**
 * A vector-similarity query: up to `k` rows ordered by descending cosine similarity of `field` to `vector`
 * (EXEC-FETCH-2). A row whose field is absent, null or of zero norm is skipped; a stored vector that is not a
 * `[number]` of the query's length, a zero-norm query or a non-positive `k` fails.
 */
export type RowNearest = {
  field: string;
  vector: number[];
  k: number;
};

/**
 * A pushed-down query: rows matching `policy` AND `filter`, ordered, then windowed. `policy` is the
 * entity's `@read` predicate already specialised to the viewer; `filter` is the call-site filter.
 */
export type RowQuery = {
  policy?: RowPredicate;
  filter?: RowPredicate;
  /** Absent = `createdAt` ascending, then `id` ascending (EXEC-FETCH-1). */
  order?: RowOrder;
  offset?: number;
  /** Absent = no limit. */
  limit?: number;
  /** Absent = `exact`. With `none` the store need not count; `total` is then only the window's size. */
  total?: RowTotalMode;
  /** The nearest `k` rows among those `policy` and `filter` admit. Excludes `order`, `offset` and `limit`; `total` is the count returned. */
  nearest?: RowNearest;
};

/** The answer to a `RowQuery`: the window, and `total` = every match before the window. */
export type RowQueryPage = RowPage<EntityRow>;

/** Value kinds a store can compare, in `compare`/`member`/`hasElement` operands. */
export type RowValueKind = "string" | "number" | "boolean" | "date" | "null";

/** Every operator a `RowPredicate` leaf can carry. */
export type RowOperator = RowCompareOp | "member" | "hasElement" | "contains";

/** The value kinds one operator accepts on a store; an operator not listed accepts every kind. */
export type OperatorValueKinds = {
  operator: RowOperator;
  valueKinds: RowValueKind[];
};

/** Whether `total` counts every match (`exact`, the default) or the store may skip the count (`none`). */
export type RowTotalMode = "exact" | "none";

/** What an adapter's `queryPage` honours for one entity type. */
export type QueryCapabilities = {
  leaves: ("compare" | "member" | "hasElement" | "contains" | "isNull")[];
  combinators: ("all" | "any" | "not")[];
  compareOps: RowCompareOp[];
  /** Per operator x value kind restrictions; absent = every kind for every declared operator. */
  operatorValueKinds?: OperatorValueKinds[];
  orderableFields: { kind: "every-field" } | { kind: "listed"; fields: string[] };
  /** offset and limit. */
  window: boolean;
  /** `total` counts every match, not the window. Needed only for `total: exact` queries. */
  exactTotal: boolean;
  /** `queryIds` is implemented. */
  idsOnly?: boolean;
  /** `nearest` is pushed down: the store ranks by cosine similarity itself (EXEC-FETCH-2). */
  nearest?: boolean;
};

/** The answer to a `queryIds`: the window's ids in order, and `total` as in `RowQueryPage`. */
export type RowIdPage = {
  ids: string[];
  total: number;
};

/**
 * One write. `create` fails (`duplicate-id`) when its id is taken. `upsert` creates the row or replaces it
 * whole by id (`created` / `updated`), keeping the existing `createdAt`. `update` changes an existing row only
 * (never an upsert) and merges `data` over it with `id` stamped last; `guard` is tested against the pre-image.
 * `delete` likewise. Native `rekey` moves an existing id with insertion-order collision semantics; support is explicit.
 */
export type RowWriteOp =
  | { kind: "create"; entityType: string; data: EntityRow }
  | { kind: "upsert"; entityType: string; data: EntityRow }
  | { kind: "update"; entityType: string; id: string; data: EntityRow; guard?: RowPredicate }
  | { kind: "delete"; entityType: string; id: string; guard?: RowPredicate }
  | { kind: "rekey"; entityType: string; id: string; newId: string; guard?: RowPredicate };

/**
 * What one write did. `before` (the pre-image) is present exactly when the op carried a guard.
 * `rolled-back` is only produced inside an `atomic` batch that failed: the op had succeeded and was undone.
 */
export type RowWriteOutcome =
  | { kind: "created"; row: EntityRow }
  | { kind: "updated"; row: EntityRow; before?: EntityRow }
  | { kind: "deleted"; before?: EntityRow }
  | { kind: "not-found" }
  | { kind: "duplicate-id" }
  | { kind: "refused" }
  | { kind: "failed"; message: string }
  | { kind: "rolled-back" };

/**
 * `atomic`: all ops apply or none do (a `persist batch`); on failure the outcomes are `rolled-back` for
 * every earlier op, then the failing outcome, and nothing is written.
 * `stop`: ops apply in order and stop at the first failure; earlier ops stay applied, later ones are
 * not attempted and have no outcome (a run of plain `persist` effects).
 */
export type RowWriteFailureMode = "atomic" | "stop";

export type RowWriteBatch = {
  ops: RowWriteOp[];
  onFailure: RowWriteFailureMode;
};

/** What an adapter's `writeWhere`/`writeBatch` honours for one entity type. */
export type WriteCapabilities = {
  /** The guard predicates the store can test; a `Pick` of the query capabilities. */
  guards: Pick<QueryCapabilities, "leaves" | "combinators" | "compareOps">;
  /** `writeWhere` tests the guard and the existence of the row in one step. */
  conditional: boolean;
  /** Outcomes carry the written row. */
  returnsRow: boolean;
  /** `writeBatch` with `onFailure: "stop"`. */
  stopRuns: boolean;
  /** `writeBatch` with `onFailure: "atomic"`; needs transactions. */
  atomicBatch: boolean;
  /** Native id moves; absent means unsupported. */
  rekey?: boolean;
  /** The store commits rows the kernel decided (`commitRows`) and holds no write semantics (EXEC-STORE-5). */
  commitRows?: boolean;
};

/** What a compare-and-commit does to one row the kernel read. */
export type RowCommitWrite = { kind: "keep" } | { kind: "put"; row: EntityRow } | { kind: "delete" };

/** One row of a compare-and-commit: the version the kernel read (`null` when absent) and what it writes (EXEC-STORE-5). */
export type RowCommit = {
  entityType: string;
  id: string;
  expected: EntityRow | null;
  write: RowCommitWrite;
};

/**
 * Storage contract for CRUD operations on entity rows. The runtime's effect
 * handlers and every database backend (`@almadar/db`) speak this interface.
 */
export interface PersistenceAdapter {
  create(entityType: string, data: EntityRow): Promise<{ id: string }>;
  update(entityType: string, id: string, data: EntityRow): Promise<void>;
  delete(entityType: string, id: string): Promise<void>;
  getById(entityType: string, id: string): Promise<EntityRow | null>;
  list(entityType: string): Promise<EntityRow[]>;
  /** Number of rows of `entityType`, without reading them; needed by a row quota. */
  countRows?(entityType: string): Promise<number>;
  /** Rows matching every filter, pushed down to the store where it can; absent = filter over `list`. */
  query?(entityType: string, filters: readonly StoreFilter<EntityRow>[]): Promise<EntityRow[]>;
  /** One page, pushed down to the store where it can; absent = page over `list`. */
  listPage?(entityType: string, request: RowPageRequest<EntityRow>): Promise<RowPage<EntityRow>>;
  /** The page of rows matching `query.policy AND query.filter`, ordered and windowed; only queries within `queryCapabilities`. */
  queryPage?(entityType: string, query: RowQuery): Promise<RowQueryPage>;
  /** What `queryPage` honours; absent = the host cannot push a query down. */
  queryCapabilities?(entityType: string): QueryCapabilities;
  /** The ids of the page `queryPage` would return, without the rows; only when `queryCapabilities.idsOnly`. */
  queryIds?(entityType: string, query: RowQuery): Promise<RowIdPage>;
  /** One conditional write; only ops within `writeCapabilities`. */
  writeWhere?(op: RowWriteOp): Promise<RowWriteOutcome>;
  /** Ordered writes with the batch's failure mode; one outcome per attempted op. */
  writeBatch?(batch: RowWriteBatch): Promise<RowWriteOutcome[]>;
  /** What `writeWhere`/`writeBatch` honour; absent = the host cannot push a write down. */
  writeCapabilities?(entityType: string): WriteCapabilities;
  /** Apply every row's write in one storage transaction only if each row still equals its `expected` version; `false` (nothing applied) on a conflict. */
  commitRows?(rows: readonly RowCommit[]): Promise<boolean>;
  /** Bind `entityType` to its declared `[persistent: tbl]` collection: a store that keys rows by collection stores the entity's rows under that name. Absent = the store keys by entity name alone. */
  bindCollection?(entityType: string, collection: string): void;
}

/**
 * Database abstraction boundary. Services receive `StoreContract<T>`,
 * not raw database clients. Swappable per database engine.
 *
 * @example
 * ```typescript
 * interface LLMRequest { id: string; prompt: string; status: string }
 *
 * class FirestoreLLMRequestStore implements StoreContract<LLMRequest> {
 *   async getById(id) { ... }
 *   async create(data) { ... }
 *   async update(id, data) { ... }
 *   async delete(id) { ... }
 *   async query(filters) { ... }
 * }
 * ```
 */
export interface StoreContract<T extends { id: string }> {
  getById(id: string): Promise<T | null>;
  create(data: Omit<T, "id">): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
  query(filters: StoreFilter<T>[]): Promise<T[]>;
}

// ============================================================================
// Lazy Service (Singleton Pattern)
// ============================================================================

/**
 * Standardized singleton lifecycle. Replaces ad-hoc
 * `let x = null; export function getX()` patterns.
 *
 * @example
 * ```typescript
 * const llmClient = createLazyService(() => new LLMClient({ apiKey: process.env.LLM_KEY }));
 *
 * // In request handler:
 * const client = llmClient.get(); // created on first call, cached after
 *
 * // In test teardown:
 * llmClient.reset(); // next get() creates a fresh instance
 * ```
 */
export interface LazyService<T> {
  /** Get the singleton instance (creates on first call). */
  get(): T;
  /** Reset the singleton (next get() creates fresh). For test isolation. */
  reset(): void;
}

/**
 * Create a lazy singleton from a factory function.
 * 
 * Creates a service that lazily initializes on first access and caches the instance.
 * Useful for expensive resources like database connections or API clients.
 * 
 * @template T - The type of service to create
 * @param {() => T} factory - Factory function that creates the service instance
 * @returns {LazyService<T>} Lazy service with get() and reset() methods
 * 
 * @example
 * const dbService = createLazyService(() => new DatabaseClient(config));
 * const db = dbService.get(); // Initializes on first call
 */
export function createLazyService<T>(factory: () => T): LazyService<T> {
  let instance: T | null = null;
  return {
    get(): T {
      if (instance === null) {
        instance = factory();
      }
      return instance;
    },
    reset(): void {
      instance = null;
    },
  };
}
