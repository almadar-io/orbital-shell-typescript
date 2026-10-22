import { AsyncLocalStorage } from 'async_hooks';
import { performance } from 'perf_hooks';

// src/timing.ts

// src/env.ts
var ENV = typeof process !== "undefined" && process.env ? process.env : {};
function envGet(key) {
  return ENV[key] ?? ENV[`VITE_${key}`];
}

// src/timing.ts
var globalKey = /* @__PURE__ */ Symbol.for("@almadar/logger/timingStore");
function getTimingStore() {
  if (!globalThis[globalKey]) {
    globalThis[globalKey] = new AsyncLocalStorage();
  }
  return globalThis[globalKey];
}
var timingStore = getTimingStore();
var PROFILING_ENABLED = envGet("NODE_ENV") !== "production";
function record(name, ms) {
  const store = timingStore.getStore();
  if (!store) return;
  store.set(name, (store.get(name) ?? 0) + ms);
}
async function time(name, fn) {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    record(name, performance.now() - start);
  }
}
var NON_TOKEN = /[^\w-]/g;
function serializeServerTiming(store = timingStore.getStore()) {
  if (!store || store.size === 0) return "";
  const parts = [];
  for (const [name, ms] of store) {
    parts.push(`${name.replace(NON_TOKEN, "_")};dur=${Math.round(ms * 10) / 10}`);
  }
  return parts.join(", ");
}
async function profile(logger, phase, fn, meta) {
  if (!PROFILING_ENABLED) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const elapsedMs = Math.round((performance.now() - start) * 10) / 10;
    record(phase, elapsedMs);
    logger.debug(`[PROFILE] ${phase}`, { elapsedMs, ...meta });
  }
}
function timingMiddleware(_req, res, next) {
  timingStore.run(/* @__PURE__ */ new Map(), () => {
    const start = performance.now();
    const originalEnd = res.end;
    res.end = ((...args) => {
      record("total", performance.now() - start);
      if (!res.headersSent) {
        const header = serializeServerTiming();
        if (header) res.setHeader("Server-Timing", header);
      }
      return originalEnd.apply(res, args);
    });
    next();
  });
}

export { profile, record, serializeServerTiming, time, timingMiddleware, timingStore };
//# sourceMappingURL=timing.js.map
//# sourceMappingURL=timing.js.map