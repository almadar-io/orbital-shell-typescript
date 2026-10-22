// src/env.ts
var ENV = typeof process !== "undefined" && process.env ? process.env : {};
function envGet(key) {
  return ENV[key] ?? ENV[`VITE_${key}`];
}

// src/observers.ts
var observers = /* @__PURE__ */ new Set();
function onLogConfigChange(fn) {
  observers.add(fn);
  return () => {
    observers.delete(fn);
  };
}
function notifyLogConfigChange() {
  for (const fn of observers) {
    try {
      fn();
    } catch {
    }
  }
}

// src/runtime-override.ts
function getRuntimeNamespaceFilter() {
  const g = globalThis;
  return g.__ALMADAR_DEBUG__;
}
function setRuntimeNamespaceFilter(value) {
  const g = globalThis;
  if (value === void 0) {
    delete g.__ALMADAR_DEBUG__;
  } else {
    g.__ALMADAR_DEBUG__ = value;
  }
  notifyLogConfigChange();
}

// src/logger.ts
var LEVEL_PRIORITY = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
var NODE_ENV = envGet("NODE_ENV") ?? "development";
var INITIAL_LEVEL = (envGet("LOG_LEVEL") ?? (NODE_ENV === "production" ? "warn" : "debug")).toUpperCase();
var currentLevel = LEVEL_PRIORITY[INITIAL_LEVEL] !== void 0 ? INITIAL_LEVEL : "DEBUG";
var namespaceLevels = /* @__PURE__ */ new Map();
var knownNamespaces = /* @__PURE__ */ new Set();
for (const entry of (envGet("ALMADAR_LOG_LEVELS") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
  const eq = entry.lastIndexOf("=");
  const level = eq > 0 ? entry.slice(eq + 1).trim().toUpperCase() : "";
  if (LEVEL_PRIORITY[level] === void 0) {
    console.warn("[almadar:logger]", `ALMADAR_LOG_LEVELS: skipped "${entry}" (expected <namespace>=debug|info|warn|error)`);
    continue;
  }
  namespaceLevels.set(entry.slice(0, eq).trim(), level);
}
function getLogLevel() {
  return currentLevel;
}
function setLogLevel(level) {
  if (LEVEL_PRIORITY[level] === void 0) return;
  currentLevel = level;
  notifyLogConfigChange();
}
function setNamespaceLevel(namespace, level) {
  if (level === null) {
    namespaceLevels.delete(namespace);
  } else if (LEVEL_PRIORITY[level] !== void 0) {
    namespaceLevels.set(namespace, level);
  }
  notifyLogConfigChange();
}
function getNamespaceLevel(namespace) {
  return namespaceLevels.get(namespace);
}
function getNamespaceLevels() {
  return namespaceLevels;
}
var ENV_FILTER_RAW = envGet("ALMADAR_DEBUG") ?? "";
var ENV_FILTER = ENV_FILTER_RAW.split(",").map((s) => s.trim()).filter(Boolean);
function matchesPatterns(namespace, patterns) {
  if (patterns.length === 0) return false;
  for (const pattern of patterns) {
    if (pattern === "*" || pattern === "almadar:*") return true;
    if (pattern.endsWith(":*")) {
      if (namespace.startsWith(pattern.slice(0, -1))) return true;
      continue;
    }
    if (namespace === pattern) return true;
  }
  return false;
}
function namespaceAllowed(namespace) {
  const runtime = getRuntimeNamespaceFilter();
  if (runtime !== void 0) {
    if (runtime === "") return false;
    const patterns = runtime.split(",").map((s) => s.trim()).filter(Boolean);
    return matchesPatterns(namespace, patterns);
  }
  if (ENV_FILTER.length === 0) return true;
  return matchesPatterns(namespace, ENV_FILTER);
}
function effectiveLevel(namespace) {
  const exact = namespaceLevels.get(namespace);
  if (exact !== void 0) return exact;
  let best;
  for (const [pattern, level] of namespaceLevels) {
    if (!pattern.endsWith(":*")) continue;
    const prefix = pattern.slice(0, -1);
    if (namespace.startsWith(prefix) && (best === void 0 || prefix.length > best.prefix.length)) best = { prefix, level };
  }
  return best?.level ?? currentLevel;
}
function effectiveMinPriority(namespace) {
  return LEVEL_PRIORITY[effectiveLevel(namespace)];
}
function getEffectiveLevel(namespace) {
  return effectiveLevel(namespace);
}
function getKnownNamespaces() {
  return [...knownNamespaces].sort();
}
function isLogLevelEnabled(level, namespace) {
  if (LEVEL_PRIORITY[level] < effectiveMinPriority(namespace)) return false;
  if (level === "DEBUG" || level === "INFO") {
    return namespaceAllowed(namespace);
  }
  return true;
}
function resolveData(data) {
  if (data === void 0) return void 0;
  if (typeof data === "function") return data();
  return data;
}
function attachCorrelation(data, cid) {
  if (!cid) return data;
  return { ...data ?? {}, cid };
}
var INITIAL_FORMAT = envGet("ALMADAR_LOG_FORMAT") === "json" ? "json" : "console";
var output = { format: INITIAL_FORMAT, context: {} };
function configureLogOutput(next) {
  output = {
    format: next.format,
    context: next.context ?? {},
    ...next.contextOf ? { contextOf: next.contextOf } : {},
    ...next.sink ? { sink: next.sink } : {}
  };
}
function getLogOutput() {
  return output;
}
var SEVERITY = { DEBUG: "DEBUG", INFO: "INFO", WARN: "WARNING", ERROR: "ERROR" };
function isMetaList(value) {
  return Array.isArray(value);
}
function toJson(value) {
  if (value === void 0) return void 0;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message, ...value.stack ? { stack: value.stack } : {} };
  if (isMetaList(value)) return value.map((item) => toJson(item) ?? null);
  return metaToJson(value);
}
function metaToJson(meta) {
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    const json = toJson(value);
    if (json !== void 0) out[key] = json;
  }
  return out;
}
function emitJson(level, namespace, message, payload, call) {
  const entry = {
    severity: SEVERITY[level],
    time: (/* @__PURE__ */ new Date()).toISOString(),
    namespace,
    message,
    ...output.contextOf?.() ?? output.context,
    ...payload ? { data: metaToJson(payload) } : {},
    ...call ? { call } : {}
  };
  console.log(JSON.stringify(entry));
  output.sink?.(entry);
}
function emit(level, prefix, message, payload) {
  const data = payload ?? "";
  switch (level) {
    case "DEBUG":
      console.debug(prefix, message, data);
      break;
    case "INFO":
      console.info(prefix, message, data);
      break;
    case "WARN":
      console.warn(prefix, message, data);
      break;
    case "ERROR":
      console.error(prefix, message, data);
      break;
  }
}
function createLogger(namespace) {
  knownNamespaces.add(namespace);
  const prefix = `[${namespace}]`;
  const allowed = (level) => LEVEL_PRIORITY[level] >= effectiveMinPriority(namespace) && (level !== "DEBUG" && level !== "INFO" || namespaceAllowed(namespace));
  const dispatch = (level, message, data, cid) => {
    if (!allowed(level)) return;
    const payload = attachCorrelation(resolveData(data), cid);
    if (output.format === "json") emitJson(level, namespace, message, payload);
    else emit(level, prefix, message, payload);
  };
  const call = (record) => {
    const message = `${record.kind} ${record.service} ${record.op}`;
    if (output.format === "json") {
      emitJson(record.ok ? "INFO" : "WARN", namespace, message, void 0, record);
      return;
    }
    if (!allowed("INFO")) return;
    const { kind, service, op, durationMs, ok, error } = record;
    emit("INFO", prefix, message, { kind, service, op, durationMs, ok, ...error !== void 0 ? { error } : {} });
  };
  return {
    debug: (msg, data, cid) => dispatch("DEBUG", msg, data, cid),
    info: (msg, data, cid) => dispatch("INFO", msg, data, cid),
    warn: (msg, data, cid) => dispatch("WARN", msg, data, cid),
    error: (msg, data, cid) => dispatch("ERROR", msg, data, cid),
    call
  };
}
var _cidCounter = 0;
function generateCorrelationId() {
  return `evt-${Date.now()}-${++_cidCounter}`;
}
async function timeCall(logger, call, fn) {
  const start = performance.now();
  try {
    const result = await fn();
    logger.call({ ...call, durationMs: performance.now() - start, ok: true });
    return result;
  } catch (err) {
    logger.call({ ...call, durationMs: performance.now() - start, ok: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// src/persistence.ts
var DEFAULT_KEY = "almadar:logger:prefs";
var persistenceKey = null;
var unsubscribe = null;
function getStorage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
  }
  return null;
}
function write() {
  if (persistenceKey === null) return;
  const storage = getStorage();
  if (storage === null) return;
  const prefs = {
    namespaceFilter: getRuntimeNamespaceFilter(),
    level: getLogLevel(),
    namespaceLevels: Object.fromEntries(getNamespaceLevels())
  };
  try {
    storage.setItem(persistenceKey, JSON.stringify(prefs));
  } catch {
  }
}
function read() {
  if (persistenceKey === null) return null;
  const storage = getStorage();
  if (storage === null) return null;
  try {
    const raw = storage.getItem(persistenceKey);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function enableLogPersistence(key = DEFAULT_KEY) {
  persistenceKey = key;
  const stored = read();
  if (stored !== null) {
    if (stored.namespaceFilter !== void 0) {
      setRuntimeNamespaceFilter(stored.namespaceFilter);
    }
    if (stored.level !== void 0) {
      setLogLevel(stored.level);
    }
    if (stored.namespaceLevels !== void 0) {
      for (const [ns, lvl] of Object.entries(stored.namespaceLevels)) {
        setNamespaceLevel(ns, lvl);
      }
    }
  }
  if (unsubscribe !== null) unsubscribe();
  unsubscribe = onLogConfigChange(write);
}
function disableLogPersistence() {
  if (unsubscribe !== null) {
    unsubscribe();
    unsubscribe = null;
  }
  persistenceKey = null;
}
function clearLogPersistence(key = DEFAULT_KEY) {
  const storage = getStorage();
  if (storage !== null) {
    try {
      storage.removeItem(key);
    } catch {
    }
  }
  disableLogPersistence();
}

export { clearLogPersistence, configureLogOutput, createLogger, disableLogPersistence, enableLogPersistence, generateCorrelationId, getEffectiveLevel, getKnownNamespaces, getLogLevel, getLogOutput, getNamespaceLevel, getNamespaceLevels, getRuntimeNamespaceFilter, isLogLevelEnabled, onLogConfigChange, setLogLevel, setNamespaceLevel, setRuntimeNamespaceFilter, timeCall };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map