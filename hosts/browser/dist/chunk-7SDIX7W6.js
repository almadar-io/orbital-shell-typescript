// src/kv.ts
function kvNamespace(app, locale, store) {
  return `kv:${app}:${locale}:${store}`;
}
function kvDatabaseName(app, locale) {
  return `kv:${app}:${locale}`;
}
var KvFailure = class extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
  kind;
};
function fail(kind, message) {
  return { error: { kind, message } };
}
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
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}
function openDatabase(factory, name, version, stores) {
  return new Promise((resolve, reject) => {
    const req = version === void 0 ? factory.open(name) : factory.open(name, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of stores) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another open connection"));
  });
}
function isJsonValue(value) {
  if (value === void 0) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  if (typeof value !== "object") return false;
  return Object.values(value).every((item) => isJsonValue(item));
}
function compareUtf8(a, b) {
  const left = Array.from(a);
  const right = Array.from(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i].codePointAt(0) ?? 0) - (right[i].codePointAt(0) ?? 0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}
function storeName(value) {
  if (typeof value !== "string" || value.length === 0) throw new KvFailure("invalid", "kv: the store name must be a non-empty string");
  return value;
}
function keyName(value) {
  if (typeof value !== "string") throw new KvFailure("invalid", "kv: the key must be a string");
  return value;
}
function jsonValue(value) {
  if (value === void 0 || !isJsonValue(value)) throw new KvFailure("invalid", "kv/put: the value must be JSON");
  return value;
}
function scanLimit(value) {
  if (value === void 0 || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new KvFailure("invalid", "kv/scan: limit must be a non-negative integer");
  return value;
}
function batchOps(value) {
  if (!Array.isArray(value)) throw new KvFailure("invalid", "kv/batch: ops must be an array");
  return value.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new KvFailure("invalid", `kv/batch: op ${index} must be an object`);
    if (item.kind === "put") return { kind: "put", key: keyName(item.key), value: jsonValue(item.value) };
    if (item.kind === "delete") return { kind: "delete", key: keyName(item.key) };
    throw new KvFailure("invalid", `kv/batch: op ${index} has an unknown kind`);
  });
}
var KvWebPort = class {
  constructor(options) {
    this.options = options;
  }
  options;
  db = null;
  lane = Promise.resolve();
  closed = false;
  pending = /* @__PURE__ */ new Map();
  factory() {
    return this.options.factory ?? globalThis.indexedDB;
  }
  /** Open the database and create the store when missing, with a version bump, as the persistence adapter did. */
  async handle(store) {
    const factory = this.factory();
    if (!factory) throw new KvFailure("unsupported", "kv: this host has no IndexedDB");
    const name = kvDatabaseName(this.options.app, this.options.locale);
    const settle = this.lane.then(async () => {
      let db = this.db ?? await openDatabase(factory, name, void 0, [store]);
      if (!db.objectStoreNames.contains(store)) {
        const next = db.version + 1;
        db.close();
        db = await openDatabase(factory, name, next, [store]);
      }
      this.db = db;
    });
    this.lane = settle.catch(() => void 0);
    await settle;
    if (this.db === null) throw new KvFailure("io", "kv: the database did not open");
    return this.db;
  }
  async run(op, args) {
    if (this.closed) throw new KvFailure("closed", "kv: the host is closed");
    const store = storeName(args[0]);
    const allow = (mode) => {
      if (this.options.allows && !this.options.allows({ need: "kv", store, mode })) {
        throw new KvFailure("denied", `kv: no ${mode} grant for store "${store}"`);
      }
    };
    switch (op) {
      case "kv/get": {
        const key = keyName(args[1]);
        allow("read");
        const db = await this.handle(store);
        const tx = db.transaction(store, "readonly");
        const objectStore = tx.objectStore(store);
        if (await request(objectStore.count(key)) === 0) return { found: false };
        return { found: true, value: await request(objectStore.get(key)) };
      }
      case "kv/put": {
        const key = keyName(args[1]);
        const value = jsonValue(args[2]);
        allow("write");
        const db = await this.handle(store);
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value, key);
        await done(tx);
        return { storedKey: key };
      }
      case "kv/delete": {
        const key = keyName(args[1]);
        allow("write");
        const db = await this.handle(store);
        const tx = db.transaction(store, "readwrite");
        const objectStore = tx.objectStore(store);
        const existed = await request(objectStore.count(key)) > 0;
        objectStore.delete(key);
        await done(tx);
        return { existed };
      }
      case "kv/scan": {
        const prefix = args[1];
        if (typeof prefix !== "string") throw new KvFailure("invalid", "kv/scan: the prefix must be a string");
        const limit = scanLimit(args[2]);
        allow("read");
        const db = await this.handle(store);
        const tx = db.transaction(store, "readonly");
        const found = [];
        await new Promise((resolve, reject) => {
          const cursor = tx.objectStore(store).openCursor(prefix === "" ? void 0 : IDBKeyRange.lowerBound(prefix));
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            const at = cursor.result;
            if (!at) return resolve();
            const key = String(at.key);
            if (!key.startsWith(prefix)) return resolve();
            found.push({ key, value: at.value });
            at.continue();
          };
        });
        found.sort((a, b) => compareUtf8(a.key, b.key));
        return { entries: limit === null ? found : found.slice(0, limit) };
      }
      case "kv/batch": {
        const ops = batchOps(args[1]);
        allow("write");
        const db = await this.handle(store);
        if (ops.length === 0) return { applied: 0 };
        const tx = db.transaction(store, "readwrite");
        const objectStore = tx.objectStore(store);
        const finished = done(tx);
        try {
          for (const item of ops) {
            if (item.kind === "put") objectStore.put(item.value, item.key);
            else objectStore.delete(item.key);
          }
        } catch (cause) {
          tx.abort();
          await finished.catch(() => void 0);
          throw cause;
        }
        await finished;
        return { applied: ops.length };
      }
    }
  }
  async answer(op, args) {
    try {
      const work = this.run(op, args);
      const timeoutMs = this.options.timeoutMs;
      if (timeoutMs === void 0) return { ok: await work };
      let timer;
      const limit = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new KvFailure("timeout", `kv: no answer in ${timeoutMs} ms`)), timeoutMs);
      });
      try {
        return { ok: await Promise.race([work, limit]) };
      } finally {
        clearTimeout(timer);
      }
    } catch (cause) {
      if (cause instanceof KvFailure) return fail(cause.kind, cause.message);
      return fail("io", cause instanceof Error ? cause.message : String(cause));
    }
  }
  defer(op, args, key, deliver) {
    if (this.closed) return fail("closed", "kv: the host is closed");
    if (this.pending.has(key)) return fail("invalid", `kv: a call with key "${key}" is already pending`);
    const entry = { cancelled: false };
    this.pending.set(key, entry);
    void this.answer(op, args).then((outcome) => {
      if (this.pending.get(key) === entry) this.pending.delete(key);
      if (!entry.cancelled) deliver(outcome);
    });
    return { ok: null };
  }
  cancel(key) {
    const entry = this.pending.get(key);
    if (!entry) return false;
    entry.cancelled = true;
    this.pending.delete(key);
    return true;
  }
  close() {
    this.closed = true;
    this.pending.clear();
    this.db?.close();
    this.db = null;
  }
};
function createKvWebPort(options) {
  return new KvWebPort(options);
}

export {
  kvNamespace,
  kvDatabaseName,
  KvWebPort,
  createKvWebPort
};
