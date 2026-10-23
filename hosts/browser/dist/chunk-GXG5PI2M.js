// src/storage/IndexedDbPersistence.ts
import { FULL_WRITE_CAPABILITIES } from "@almadar/core";
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
  writeCapabilities(_entityType) {
    return { ...FULL_WRITE_CAPABILITIES, commitRows: true };
  }
  /** The kernel's decided rows, applied in one readwrite transaction only if each row still equals the version it read (EXEC-STORE-5). */
  async commitRows(rows) {
    if (rows.length === 0) return true;
    const stores = [...new Set(rows.map((row) => this.store(row.entityType)))];
    const tx = this.db.transaction([...stores, CHANGE_LOG], "readwrite");
    const log = tx.objectStore(CHANGE_LOG);
    for (const row of rows) {
      const current = await request(tx.objectStore(row.entityType).get(row.id));
      if (!sameRow(current ?? null, row.expected)) {
        tx.abort();
        await done(tx).catch(() => void 0);
        return false;
      }
    }
    for (const row of rows) {
      const objectStore = tx.objectStore(row.entityType);
      if (row.write.kind === "put") {
        const stored = { ...row.write.row, updatedAt: this.now() };
        objectStore.put(stored);
        log.add({ op: row.expected === null ? "create" : "update", entityType: row.entityType, id: row.id, row: stored, at: this.now() });
      } else if (row.write.kind === "delete") {
        objectStore.delete(row.id);
        log.add({ op: "delete", entityType: row.entityType, id: row.id, row: null, at: this.now() });
      }
    }
    await done(tx);
    return true;
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
function sameRow(a, b) {
  return sameValue(a, b);
}
function sameValue(a, b) {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (a === null || b === null || a === void 0 || b === void 0 || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => sameValue(a[key], b[key]));
}

export {
  CHANGE_LOG,
  IndexedDbPersistence
};
