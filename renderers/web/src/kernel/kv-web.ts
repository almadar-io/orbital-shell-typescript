/**
 * The `kv` port of a browser kernel host: `kv/get|put|delete|scan|batch` over IndexedDB, with no Node builtin in sight.
 * The grant check is the Rust `OsGrants` kv requirement, passed in as `allows`; this file only maps a verified request.
 * One IndexedDB database per app and locale (`kv:<app>:<locale>`), one object store per kv store, out-of-line string keys.
 */
import type { JsonValue } from '@almadar/core';
import type { OsError, OsErrorKind, Settled } from '@almadar/core/kernel-wire';

export type KvOp = 'kv/get' | 'kv/put' | 'kv/delete' | 'kv/scan' | 'kv/batch';
export type KvMode = 'read' | 'write';

/** One thing a `kv/` call needs from the program's grants: the JSON of the Rust `kv` requirement. */
export interface KvRequirement {
  need: 'kv';
  store: string;
  mode: KvMode;
}

export type KvBatchOp = { kind: 'put'; key: string; value: JsonValue } | { kind: 'delete'; key: string };

export interface KvHostPort {
  answer(op: KvOp, args: JsonValue[]): Promise<Settled<JsonValue, OsError>>;
  defer?(op: KvOp, args: JsonValue[], key: string, deliver: (outcome: Settled<JsonValue, OsError>) => void): Settled<null, OsError>;
  cancel?(key: string): boolean;
  close(): void;
}

export interface KvWebOptions {
  app: string;
  locale: string;
  /** Defaults to `globalThis.indexedDB`; a host without one answers every ask `unsupported`. */
  factory?: IDBFactory;
  /** The wasm grant decision (`OsGrants` kv requirement). Absent means every request is allowed. */
  allows?: (need: KvRequirement) => boolean;
  /** Fails an ask with `timeout` when storage has not answered in this many milliseconds. */
  timeoutMs?: number;
}

/** The namespace a kv store lives under: `kv:<app>:<locale>:<store>`. */
export function kvNamespace(app: string, locale: string, store: string): string {
  return `kv:${app}:${locale}:${store}`;
}

/** The IndexedDB database that holds every kv store of one app and locale. */
export function kvDatabaseName(app: string, locale: string): string {
  return `kv:${app}:${locale}`;
}

class KvFailure extends Error {
  constructor(readonly kind: OsErrorKind, message: string) {
    super(message);
  }
}

function fail(kind: OsErrorKind, message: string): Settled<never, OsError> {
  return { error: { kind, message } };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

function openDatabase(factory: IDBFactory, name: string, version: number | undefined, stores: readonly string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? factory.open(name) : factory.open(name, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of stores) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another open connection'));
  });
}

function isJsonValue(value: JsonValue | undefined): boolean {
  if (value === undefined) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  if (typeof value !== 'object') return false;
  return Object.values(value).every((item) => isJsonValue(item));
}

/** Code point order equals UTF-8 byte order; IndexedDB compares UTF-16 code units, which differs above U+FFFF. */
function compareUtf8(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i].codePointAt(0) ?? 0) - (right[i].codePointAt(0) ?? 0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

function storeName(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || value.length === 0) throw new KvFailure('invalid', 'kv: the store name must be a non-empty string');
  return value;
}

function keyName(value: JsonValue | undefined): string {
  if (typeof value !== 'string') throw new KvFailure('invalid', 'kv: the key must be a string');
  return value;
}

function jsonValue(value: JsonValue | undefined): JsonValue {
  if (value === undefined || !isJsonValue(value)) throw new KvFailure('invalid', 'kv/put: the value must be JSON');
  return value;
}

function scanLimit(value: JsonValue | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new KvFailure('invalid', 'kv/scan: limit must be a non-negative integer');
  return value;
}

function batchOps(value: JsonValue | undefined): KvBatchOp[] {
  if (!Array.isArray(value)) throw new KvFailure('invalid', 'kv/batch: ops must be an array');
  return value.map((item, index): KvBatchOp => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new KvFailure('invalid', `kv/batch: op ${index} must be an object`);
    if (item.kind === 'put') return { kind: 'put', key: keyName(item.key), value: jsonValue(item.value) };
    if (item.kind === 'delete') return { kind: 'delete', key: keyName(item.key) };
    throw new KvFailure('invalid', `kv/batch: op ${index} has an unknown kind`);
  });
}

export class KvWebPort implements KvHostPort {
  private db: IDBDatabase | null = null;
  private lane: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly pending = new Map<string, { cancelled: boolean }>();

  constructor(private readonly options: KvWebOptions) {}

  private factory(): IDBFactory | undefined {
    return this.options.factory ?? globalThis.indexedDB;
  }

  /** Open the database and create the store when missing, with a version bump, as the persistence adapter did. */
  private async handle(store: string): Promise<IDBDatabase> {
    const factory = this.factory();
    if (!factory) throw new KvFailure('unsupported', 'kv: this host has no IndexedDB');
    const name = kvDatabaseName(this.options.app, this.options.locale);
    const settle = this.lane.then(async () => {
      let db = this.db ?? (await openDatabase(factory, name, undefined, [store]));
      if (!db.objectStoreNames.contains(store)) {
        const next = db.version + 1;
        db.close();
        db = await openDatabase(factory, name, next, [store]);
      }
      this.db = db;
    });
    this.lane = settle.catch(() => undefined);
    await settle;
    if (this.db === null) throw new KvFailure('io', 'kv: the database did not open');
    return this.db;
  }

  private async run(op: KvOp, args: JsonValue[]): Promise<JsonValue> {
    if (this.closed) throw new KvFailure('closed', 'kv: the host is closed');
    const store = storeName(args[0]);
    const allow = (mode: KvMode): void => {
      if (this.options.allows && !this.options.allows({ need: 'kv', store, mode })) {
        throw new KvFailure('denied', `kv: no ${mode} grant for store "${store}"`);
      }
    };
    switch (op) {
      case 'kv/get': {
        const key = keyName(args[1]);
        allow('read');
        const db = await this.handle(store);
        const tx = db.transaction(store, 'readonly');
        const objectStore = tx.objectStore(store);
        if ((await request(objectStore.count(key))) === 0) return { found: false };
        return { found: true, value: await request<JsonValue>(objectStore.get(key)) };
      }
      case 'kv/put': {
        const key = keyName(args[1]);
        const value = jsonValue(args[2]);
        allow('write');
        const db = await this.handle(store);
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        await done(tx);
        return { key };
      }
      case 'kv/delete': {
        const key = keyName(args[1]);
        allow('write');
        const db = await this.handle(store);
        const tx = db.transaction(store, 'readwrite');
        const objectStore = tx.objectStore(store);
        const existed = (await request(objectStore.count(key))) > 0;
        objectStore.delete(key);
        await done(tx);
        return { existed };
      }
      case 'kv/scan': {
        const prefix = args[1];
        if (typeof prefix !== 'string') throw new KvFailure('invalid', 'kv/scan: the prefix must be a string');
        const limit = scanLimit(args[2]);
        allow('read');
        const db = await this.handle(store);
        const tx = db.transaction(store, 'readonly');
        const found: Array<{ key: string; value: JsonValue }> = [];
        await new Promise<void>((resolve, reject) => {
          const cursor = tx.objectStore(store).openCursor(prefix === '' ? undefined : IDBKeyRange.lowerBound(prefix));
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            const at = cursor.result;
            if (!at) return resolve();
            const key = String(at.key);
            if (!key.startsWith(prefix)) return resolve();
            found.push({ key, value: at.value as JsonValue });
            at.continue();
          };
        });
        found.sort((a, b) => compareUtf8(a.key, b.key));
        return { entries: limit === null ? found : found.slice(0, limit) };
      }
      case 'kv/batch': {
        const ops = batchOps(args[1]);
        allow('write');
        const db = await this.handle(store);
        if (ops.length === 0) return { applied: 0 };
        const tx = db.transaction(store, 'readwrite');
        const objectStore = tx.objectStore(store);
        const finished = done(tx);
        try {
          for (const item of ops) {
            if (item.kind === 'put') objectStore.put(item.value, item.key);
            else objectStore.delete(item.key);
          }
        } catch (cause) {
          tx.abort();
          await finished.catch(() => undefined);
          throw cause;
        }
        await finished;
        return { applied: ops.length };
      }
    }
  }

  async answer(op: KvOp, args: JsonValue[]): Promise<Settled<JsonValue, OsError>> {
    try {
      const work = this.run(op, args);
      const timeoutMs = this.options.timeoutMs;
      if (timeoutMs === undefined) return { ok: await work };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new KvFailure('timeout', `kv: no answer in ${timeoutMs} ms`)), timeoutMs);
      });
      try {
        return { ok: await Promise.race([work, limit]) };
      } finally {
        clearTimeout(timer);
      }
    } catch (cause) {
      if (cause instanceof KvFailure) return fail(cause.kind, cause.message);
      return fail('io', cause instanceof Error ? cause.message : String(cause));
    }
  }

  defer(op: KvOp, args: JsonValue[], key: string, deliver: (outcome: Settled<JsonValue, OsError>) => void): Settled<null, OsError> {
    if (this.closed) return fail('closed', 'kv: the host is closed');
    if (this.pending.has(key)) return fail('invalid', `kv: a call with key "${key}" is already pending`);
    const entry = { cancelled: false };
    this.pending.set(key, entry);
    void this.answer(op, args).then((outcome) => {
      if (this.pending.get(key) === entry) this.pending.delete(key);
      if (!entry.cancelled) deliver(outcome);
    });
    return { ok: null };
  }

  cancel(key: string): boolean {
    const entry = this.pending.get(key);
    if (!entry) return false;
    entry.cancelled = true;
    this.pending.delete(key);
    return true;
  }

  close(): void {
    this.closed = true;
    this.pending.clear();
    this.db?.close();
    this.db = null;
  }
}

export function createKvWebPort(options: KvWebOptions): KvHostPort {
  return new KvWebPort(options);
}
