/**
 * IndexedDbPersistence — the browser store for `[persistent: x, local]` entities.
 *
 * Implements the shared `PersistenceAdapter` contract, so the effect stage runs
 * `fetch`/`persist` against it exactly as a server runs them against Firestore
 * or Postgres. Sync-ready: minted ids are UUIDs, every write stamps `updatedAt`
 * and appends to an ordered change log (`__changes`) a later sync can replay.
 * It answers plain reads; the kernel filters, orders and windows rows itself. Writes arrive as one
 * compare-and-commit of rows the kernel decided (EXEC-STORE-5), so the store holds no query or write semantics.
 *
 * @packageDocumentation
 */
import { FULL_WRITE_CAPABILITIES, type EntityRow, type FieldValue, type PersistenceAdapter, type RowCommit, type WriteCapabilities } from "@almadar/core";

/** Object store holding the append-only write log. */
export const CHANGE_LOG = "__changes";

export interface ChangeRecord {
  op: "create" | "update" | "delete";
  entityType: string;
  id: string;
  row: EntityRow | null;
  at: string;
}

export interface IndexedDbPersistenceOptions {
  /** One database per app, e.g. `almadar:<app name>`. */
  databaseName: string;
  /** Every browser-stored entity type this store holds (one object store each). */
  entityTypes: readonly string[];
  /** IndexedDB implementation; defaults to the browser's `indexedDB`. */
  factory?: IDBFactory;
  /** Clock for `updatedAt` / change stamps; defaults to `new Date().toISOString()`. */
  now?: () => string;
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
    tx.onabort = () => reject(tx.error);
  });
}

function openDatabase(factory: IDBFactory, name: string, version: number | undefined, stores: readonly string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? factory.open(name) : factory.open(name, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of stores) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, store === CHANGE_LOG ? { autoIncrement: true } : { keyPath: "id" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbPersistence implements PersistenceAdapter {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly entityTypes: ReadonlySet<string>,
    private readonly now: () => string,
  ) {}

  /** Open (creating or upgrading) the database so it holds every listed entity type. */
  static async open(options: IndexedDbPersistenceOptions): Promise<IndexedDbPersistence> {
    const factory = options.factory ?? globalThis.indexedDB;
    if (!factory) throw new Error("IndexedDbPersistence: this environment has no IndexedDB");
    const stores = [...options.entityTypes, CHANGE_LOG];
    let db = await openDatabase(factory, options.databaseName, undefined, stores);
    if (stores.some((s) => !db.objectStoreNames.contains(s))) {
      const next = db.version + 1;
      db.close();
      db = await openDatabase(factory, options.databaseName, next, stores);
    }
    return new IndexedDbPersistence(db, new Set(options.entityTypes), options.now ?? (() => new Date().toISOString()));
  }

  close(): void {
    this.db.close();
  }

  private store(entityType: string): string {
    if (!this.entityTypes.has(entityType)) {
      throw new Error(`IndexedDbPersistence: not opened with entity type "${entityType}"`);
    }
    return entityType;
  }

  private async write(entityType: string, op: ChangeRecord["op"], id: string, row: EntityRow | null): Promise<void> {
    const tx = this.db.transaction([this.store(entityType), CHANGE_LOG], "readwrite");
    if (row) tx.objectStore(entityType).put(row);
    else tx.objectStore(entityType).delete(id);
    const change: ChangeRecord = { op, entityType, id, row, at: this.now() };
    tx.objectStore(CHANGE_LOG).add(change);
    await done(tx);
  }

  async create(entityType: string, data: EntityRow): Promise<{ id: string }> {
    const id = typeof data.id === "string" && data.id.length > 0 ? data.id : crypto.randomUUID();
    await this.write(entityType, "create", id, { ...data, id, updatedAt: this.now() });
    return { id };
  }

  async update(entityType: string, id: string, data: EntityRow): Promise<void> {
    const existing = await this.getById(entityType, id);
    if (!existing) return;
    await this.write(entityType, "update", id, { ...existing, ...data, id, updatedAt: this.now() });
  }

  async delete(entityType: string, id: string): Promise<void> {
    await this.write(entityType, "delete", id, null);
  }

  async getById(entityType: string, id: string): Promise<EntityRow | null> {
    const tx = this.db.transaction(this.store(entityType), "readonly");
    const row = await request<EntityRow | undefined>(tx.objectStore(entityType).get(id));
    return row ?? null;
  }

  async list(entityType: string): Promise<EntityRow[]> {
    const tx = this.db.transaction(this.store(entityType), "readonly");
    return request<EntityRow[]>(tx.objectStore(entityType).getAll());
  }

  writeCapabilities(_entityType: string): WriteCapabilities {
    return { ...FULL_WRITE_CAPABILITIES, commitRows: true };
  }

  /** The kernel's decided rows, applied in one readwrite transaction only if each row still equals the version it read (EXEC-STORE-5). */
  async commitRows(rows: readonly RowCommit[]): Promise<boolean> {
    if (rows.length === 0) return true;
    const stores = [...new Set(rows.map((row) => this.store(row.entityType)))];
    const tx = this.db.transaction([...stores, CHANGE_LOG], "readwrite");
    const log = tx.objectStore(CHANGE_LOG);
    for (const row of rows) {
      const current = await request<EntityRow | undefined>(tx.objectStore(row.entityType).get(row.id));
      if (!sameRow(current ?? null, row.expected)) {
        tx.abort();
        await done(tx).catch(() => undefined);
        return false;
      }
    }
    for (const row of rows) {
      const objectStore = tx.objectStore(row.entityType);
      if (row.write.kind === "put") {
        const stored: EntityRow = { ...row.write.row, updatedAt: this.now() };
        objectStore.put(stored);
        log.add({ op: row.expected === null ? "create" : "update", entityType: row.entityType, id: row.id, row: stored, at: this.now() } satisfies ChangeRecord);
      } else if (row.write.kind === "delete") {
        objectStore.delete(row.id);
        log.add({ op: "delete", entityType: row.entityType, id: row.id, row: null, at: this.now() } satisfies ChangeRecord);
      }
    }
    await done(tx);
    return true;
  }

  async countRows(entityType: string): Promise<number> {
    const tx = this.db.transaction(this.store(entityType), "readonly");
    return request<number>(tx.objectStore(entityType).count());
  }

  /** The write log, oldest first — the seam a later `sync` replays. */
  async changes(): Promise<ChangeRecord[]> {
    const tx = this.db.transaction(CHANGE_LOG, "readonly");
    return request<ChangeRecord[]>(tx.objectStore(CHANGE_LOG).getAll());
  }
}

/** Plain structural equality of two stored rows: the compare in compare-and-commit, no predicate logic. */
function sameRow(a: EntityRow | null, b: EntityRow | null): boolean {
  return sameValue(a, b);
}

function sameValue(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (a === null || b === null || a === undefined || b === undefined || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => sameValue(a[key], b[key]));
}
