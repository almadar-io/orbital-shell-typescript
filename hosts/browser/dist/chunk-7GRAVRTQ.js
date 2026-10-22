// src/storage/IndexedDbPersistence.ts
import { FULL_QUERY_CAPABILITIES, FULL_WRITE_CAPABILITIES, rowMatchesPredicate, runRowIds, runRowQuery, runRowWrite } from "@almadar/core";
var CHANGE_LOG = "__changes";
function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function openDatabase(factory, name, version, stores) {
  return new Promise((resolve, reject) => {
    const req = version === void 0 ? factory.open(name) : factory.open(name, version);
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
var IndexedDbPersistence = class _IndexedDbPersistence {
  constructor(db, entityTypes, now) {
    this.db = db;
    this.entityTypes = entityTypes;
    this.now = now;
  }
  db;
  entityTypes;
  now;
  /** Open (creating or upgrading) the database so it holds every listed entity type. */
  static async open(options) {
    const factory = options.factory ?? globalThis.indexedDB;
    if (!factory) throw new Error("IndexedDbPersistence: this environment has no IndexedDB");
    const stores = [...options.entityTypes, CHANGE_LOG];
    let db = await openDatabase(factory, options.databaseName, void 0, stores);
    if (stores.some((s) => !db.objectStoreNames.contains(s))) {
      const next = db.version + 1;
      db.close();
      db = await openDatabase(factory, options.databaseName, next, stores);
    }
    return new _IndexedDbPersistence(db, new Set(options.entityTypes), options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString()));
  }
  close() {
    this.db.close();
  }
  store(entityType) {
    if (!this.entityTypes.has(entityType)) {
      throw new Error(`IndexedDbPersistence: not opened with entity type "${entityType}"`);
    }
    return entityType;
  }
  async write(entityType, op, id, row) {
    const tx = this.db.transaction([this.store(entityType), CHANGE_LOG], "readwrite");
    if (row) tx.objectStore(entityType).put(row);
    else tx.objectStore(entityType).delete(id);
    const change = { op, entityType, id, row, at: this.now() };
    tx.objectStore(CHANGE_LOG).add(change);
    await done(tx);
  }
  async create(entityType, data) {
    const id = typeof data.id === "string" && data.id.length > 0 ? data.id : crypto.randomUUID();
    await this.write(entityType, "create", id, { ...data, id, updatedAt: this.now() });
    return { id };
  }
  async update(entityType, id, data) {
    const existing = await this.getById(entityType, id);
    if (!existing) return;
    await this.write(entityType, "update", id, { ...existing, ...data, id, updatedAt: this.now() });
  }
  async delete(entityType, id) {
    await this.write(entityType, "delete", id, null);
  }
  async getById(entityType, id) {
    const tx = this.db.transaction(this.store(entityType), "readonly");
    const row = await request(tx.objectStore(entityType).get(id));
    return row ?? null;
  }
  async list(entityType) {
    const tx = this.db.transaction(this.store(entityType), "readonly");
    return request(tx.objectStore(entityType).getAll());
  }
  async matching(entityType, query) {
    const tx = this.db.transaction(this.store(entityType), "readonly");
    const matched = [];
    await new Promise((resolve, reject) => {
      const cursor = tx.objectStore(entityType).openCursor();
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) return resolve();
        const row = at.value;
        if ((query.policy === void 0 || rowMatchesPredicate(row, query.policy)) && (query.filter === void 0 || rowMatchesPredicate(row, query.filter))) {
          matched.push(row);
        }
        at.continue();
      };
    });
    return matched;
  }
  async queryPage(entityType, query) {
    return runRowQuery(await this.matching(entityType, query), { order: query.order, offset: query.offset, limit: query.limit, total: query.total, nearest: query.nearest });
  }
  async queryIds(entityType, query) {
    return runRowIds(await this.matching(entityType, query), { order: query.order, offset: query.offset, limit: query.limit, total: query.total, nearest: query.nearest });
  }
  queryCapabilities(_entityType) {
    return { ...FULL_QUERY_CAPABILITIES, idsOnly: true };
  }
  writeCapabilities(_entityType) {
    return FULL_WRITE_CAPABILITIES;
  }
  async writeWhere(op) {
    const [outcome] = await this.writeInTransaction({ ops: [op], onFailure: "stop" });
    return outcome;
  }
  async writeBatch(batch) {
    return this.writeInTransaction(batch);
  }
  /** Every op reads and writes inside one readwrite transaction; an atomic batch that fails aborts it, a stop run commits its applied prefix. */
  async writeInTransaction(batch) {
    if (batch.ops.length === 0) return [];
    const stores = [...new Set(batch.ops.map((op) => this.store(op.entityType)))];
    const tx = this.db.transaction([...stores, CHANGE_LOG], "readwrite");
    const log = tx.objectStore(CHANGE_LOG);
    const outcomes = [];
    for (const op of batch.ops) {
      const objectStore = tx.objectStore(op.entityType);
      const id = op.kind === "create" || op.kind === "upsert" ? typeof op.data.id === "string" ? op.data.id : null : op.id;
      const existing = id === null ? void 0 : await request(objectStore.get(id));
      const { outcome } = runRowWrite(existing ? [existing] : [], op);
      if (outcome.kind === "created" || outcome.kind === "updated") {
        const row = { ...outcome.row, updatedAt: this.now() };
        objectStore.put(row);
        log.add({ op: outcome.kind === "created" ? "create" : "update", entityType: op.entityType, id: String(row.id), row, at: this.now() });
        outcomes.push({ ...outcome, row });
      } else if (outcome.kind === "deleted" && op.kind === "delete") {
        objectStore.delete(op.id);
        log.add({ op: "delete", entityType: op.entityType, id: op.id, row: null, at: this.now() });
        outcomes.push(outcome);
      } else {
        outcomes.push(outcome);
        if (batch.onFailure === "atomic") {
          tx.abort();
          await done(tx).catch(() => void 0);
          return [...outcomes.slice(0, -1).map(() => ({ kind: "rolled-back" })), outcome];
        }
        break;
      }
    }
    await done(tx);
    return outcomes;
  }
  async countRows(entityType) {
    const tx = this.db.transaction(this.store(entityType), "readonly");
    return request(tx.objectStore(entityType).count());
  }
  /** The write log, oldest first — the seam a later `sync` replays. */
  async changes() {
    const tx = this.db.transaction(CHANGE_LOG, "readonly");
    return request(tx.objectStore(CHANGE_LOG).getAll());
  }
};

export {
  CHANGE_LOG,
  IndexedDbPersistence
};
