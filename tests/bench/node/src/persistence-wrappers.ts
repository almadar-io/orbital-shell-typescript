import type { EntityRow, PersistenceAdapter } from '@almadar/core';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits `latencyMs` before every I/O call so a flight suspends and others interleave. Optional members (queries,
 * conditional writes, capabilities) are present on the wrapper exactly when the inner adapter has them, as in
 * `CountingPersistence`, so push-down engages through it.
 */
export class LatencyPersistence implements PersistenceAdapter {
  readonly countRows?: PersistenceAdapter['countRows'];
  readonly query?: PersistenceAdapter['query'];
  readonly listPage?: PersistenceAdapter['listPage'];
  readonly queryPage?: PersistenceAdapter['queryPage'];
  readonly queryCapabilities?: PersistenceAdapter['queryCapabilities'];
  readonly queryIds?: PersistenceAdapter['queryIds'];
  readonly writeWhere?: PersistenceAdapter['writeWhere'];
  readonly writeBatch?: PersistenceAdapter['writeBatch'];
  readonly writeCapabilities?: PersistenceAdapter['writeCapabilities'];

  constructor(private readonly inner: PersistenceAdapter, private readonly latencyMs: number) {
    const { countRows, query, listPage, queryPage, queryCapabilities, queryIds, writeWhere, writeBatch, writeCapabilities } = inner;
    if (countRows) this.countRows = (t) => this.after(() => countRows.call(inner, t));
    if (query) this.query = (t, f) => this.after(() => query.call(inner, t, f));
    if (listPage) this.listPage = (t, r) => this.after(() => listPage.call(inner, t, r));
    if (queryPage) this.queryPage = (t, r) => this.after(() => queryPage.call(inner, t, r));
    if (queryCapabilities) this.queryCapabilities = queryCapabilities.bind(inner);
    if (queryIds) this.queryIds = (t, r) => this.after(() => queryIds.call(inner, t, r));
    if (writeWhere) this.writeWhere = (op) => this.after(() => writeWhere.call(inner, op));
    if (writeBatch) this.writeBatch = (batch) => this.after(() => writeBatch.call(inner, batch));
    if (writeCapabilities) this.writeCapabilities = writeCapabilities.bind(inner);
  }

  private async after<T>(run: () => Promise<T>): Promise<T> {
    if (this.latencyMs > 0) await delay(this.latencyMs);
    return run();
  }

  create(entityType: string, data: EntityRow): Promise<{ id: string }> {
    return this.after(() => this.inner.create(entityType, data));
  }

  update(entityType: string, id: string, data: EntityRow): Promise<void> {
    return this.after(() => this.inner.update(entityType, id, data));
  }

  delete(entityType: string, id: string): Promise<void> {
    return this.after(() => this.inner.delete(entityType, id));
  }

  getById(entityType: string, id: string): Promise<EntityRow | null> {
    return this.after(() => this.inner.getById(entityType, id));
  }

  list(entityType: string): Promise<EntityRow[]> {
    return this.after(() => this.inner.list(entityType));
  }
}

/** Every adapter call a {@link CountingPersistence} tallies. */
export const PERSISTENCE_METHODS = ['getById', 'list', 'create', 'update', 'delete', 'countRows', 'query', 'listPage', 'queryPage', 'queryIds', 'writeWhere', 'writeBatch'] as const;
export type PersistenceMethod = (typeof PERSISTENCE_METHODS)[number];

/**
 * Counts the calls the host makes on the adapter, by method. Optional members are present on the wrapper exactly when
 * the inner adapter has them, so push-down engages through it as it does through `LatencyPersistence`.
 */
export class CountingPersistence implements PersistenceAdapter {
  readonly countRows?: PersistenceAdapter['countRows'];
  readonly query?: PersistenceAdapter['query'];
  readonly listPage?: PersistenceAdapter['listPage'];
  readonly queryPage?: PersistenceAdapter['queryPage'];
  readonly queryCapabilities?: PersistenceAdapter['queryCapabilities'];
  readonly queryIds?: PersistenceAdapter['queryIds'];
  readonly writeWhere?: PersistenceAdapter['writeWhere'];
  readonly writeBatch?: PersistenceAdapter['writeBatch'];
  readonly writeCapabilities?: PersistenceAdapter['writeCapabilities'];
  private tally: Record<PersistenceMethod, number> = emptyTally();

  constructor(private readonly inner: PersistenceAdapter) {
    const { countRows, query, listPage, queryPage, queryCapabilities, queryIds, writeWhere, writeBatch, writeCapabilities } = inner;
    if (countRows) this.countRows = (t) => this.counted('countRows', () => countRows.call(inner, t));
    if (query) this.query = (t, f) => this.counted('query', () => query.call(inner, t, f));
    if (listPage) this.listPage = (t, r) => this.counted('listPage', () => listPage.call(inner, t, r));
    if (queryPage) this.queryPage = (t, r) => this.counted('queryPage', () => queryPage.call(inner, t, r));
    if (queryCapabilities) this.queryCapabilities = queryCapabilities.bind(inner);
    if (queryIds) this.queryIds = (t, r) => this.counted('queryIds', () => queryIds.call(inner, t, r));
    if (writeWhere) this.writeWhere = (op) => this.counted('writeWhere', () => writeWhere.call(inner, op));
    if (writeBatch) this.writeBatch = (batch) => this.counted('writeBatch', () => writeBatch.call(inner, batch));
    if (writeCapabilities) this.writeCapabilities = writeCapabilities.bind(inner);
  }

  private counted<T>(method: PersistenceMethod, run: () => Promise<T>): Promise<T> {
    this.tally[method] += 1;
    return run();
  }

  counts(): { byMethod: Record<PersistenceMethod, number> } {
    return { byMethod: { ...this.tally } };
  }

  reset(): void {
    this.tally = emptyTally();
  }

  create(entityType: string, data: EntityRow): Promise<{ id: string }> {
    return this.counted('create', () => this.inner.create(entityType, data));
  }

  update(entityType: string, id: string, data: EntityRow): Promise<void> {
    return this.counted('update', () => this.inner.update(entityType, id, data));
  }

  delete(entityType: string, id: string): Promise<void> {
    return this.counted('delete', () => this.inner.delete(entityType, id));
  }

  getById(entityType: string, id: string): Promise<EntityRow | null> {
    return this.counted('getById', () => this.inner.getById(entityType, id));
  }

  list(entityType: string): Promise<EntityRow[]> {
    return this.counted('list', () => this.inner.list(entityType));
  }
}

function emptyTally(): Record<PersistenceMethod, number> {
  return { getById: 0, list: 0, create: 0, update: 0, delete: 0, countRows: 0, query: 0, listPage: 0, queryPage: 0, queryIds: 0, writeWhere: 0, writeBatch: 0 };
}

/** Only the five core methods: no query, conditional-write or capability members, so the runtime takes the fallback path. */
export class PlainPersistence implements PersistenceAdapter {
  constructor(private readonly inner: PersistenceAdapter) {}

  create(entityType: string, data: EntityRow): Promise<{ id: string }> {
    return this.inner.create(entityType, data);
  }

  update(entityType: string, id: string, data: EntityRow): Promise<void> {
    return this.inner.update(entityType, id, data);
  }

  delete(entityType: string, id: string): Promise<void> {
    return this.inner.delete(entityType, id);
  }

  getById(entityType: string, id: string): Promise<EntityRow | null> {
    return this.inner.getById(entityType, id);
  }

  list(entityType: string): Promise<EntityRow[]> {
    return this.inner.list(entityType);
  }
}

/** `kernel.fetch.pushdown-fallback:<reason>` / `kernel.write.pushdown-fallback:<reason>` -> times logged. */
export type FallbackNotices = Record<string, number>;

const NOTICE = /^kernel\.(fetch|write)\.pushdown-fallback$/;

function noticeKey(args: readonly unknown[]): string | null {
  const record = (message: unknown, data: unknown): string | null => {
    if (typeof message !== 'string' || !NOTICE.test(message)) return null;
    const reason = typeof data === 'object' && data !== null && 'reason' in data ? String(data.reason) : 'unknown';
    return `${message}:${reason}`;
  };
  if (typeof args[0] === 'string' && args[0].startsWith('{')) {
    try {
      const entry: unknown = JSON.parse(args[0]);
      if (typeof entry === 'object' && entry !== null && 'message' in entry) return record(entry.message, 'data' in entry ? entry.data : undefined);
    } catch {
      return null;
    }
    return null;
  }
  return record(args[1], args[2]);
}

/** Runs `run` while counting the runtime's push-down fallback notices (console line or JSON log entry; the runtime logs each once per adapter, entity and reason). */
export async function captureFallbackNotices<T>(run: () => Promise<T>): Promise<{ value: T; notices: FallbackNotices }> {
  const notices: FallbackNotices = {};
  const originals = { warn: console.warn, log: console.log };
  const hook = (original: typeof console.warn) => (...args: unknown[]): void => {
    const key = noticeKey(args);
    if (key === null) original(...args);
    else notices[key] = (notices[key] ?? 0) + 1;
  };
  console.warn = hook(originals.warn);
  console.log = hook(originals.log);
  try {
    return { value: await run(), notices };
  } finally {
    console.warn = originals.warn;
    console.log = originals.log;
  }
}

export function formatNotices(notices: FallbackNotices): string {
  const entries = Object.entries(notices);
  return entries.length === 0 ? 'pushed (no fallback notices)' : entries.map(([k, n]) => `${k} x${n}`).join(', ');
}
