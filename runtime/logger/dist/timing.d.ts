import { AsyncLocalStorage } from 'node:async_hooks';
import { IncomingMessage, ServerResponse } from 'node:http';
import { d as Logger, L as LogData } from './logger-A7Kdh2zn.js';
import '@almadar/core';

/**
 * Request-scoped performance timing — `AsyncLocalStorage` + `perf_hooks`,
 * surfaced as a `Server-Timing` response header.
 *
 * Node-only (uses `node:` built-ins). Exposed solely via the
 * `@almadar/logger/timing` subpath so the browser-safe main entry never pulls
 * `async_hooks`/`perf_hooks`. Framework-agnostic: the middleware is typed against
 * Node's `http` types, so any framework whose `res` extends `ServerResponse`
 * (Express, connect, raw http) works without a framework dependency.
 */

/** name → accumulated milliseconds for the current request. */
type TimingStore = Map<string, number>;
declare const timingStore: AsyncLocalStorage<TimingStore>;
/** Add `ms` under `name` into the active request store. No-op off the request path. */
declare function record(name: string, ms: number): void;
/** Time `fn`, accumulating its wall-clock duration (ms) under `name`. */
declare function time<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
/**
 * Serialize a store to a `Server-Timing` header value:
 * `name;dur=12.3, name2;dur=4`. Defaults to the active request store.
 */
declare function serializeServerTiming(store?: TimingStore | undefined): string;
/**
 * Profile an async phase for BOTH observability surfaces at once: accumulates
 * wall-clock duration into the active Server-Timing store (when `timingMiddleware`
 * is installed) AND emits a structured `[PROFILE]` log line via the provided
 * logger. `meta` is merged into the log data so callers can attach `operation`,
 * `graphId`, `model`, etc. — anything grep-able.
 *
 * DEV-only: in production this is a zero-overhead passthrough (no `performance.now`,
 * no log dispatch). Off the request path (no middleware), `record` is a no-op
 * but the log line still fires, so this works in background jobs, tests, and
 * CLI tools too.
 */
declare function profile<T>(logger: Pick<Logger, 'debug'>, phase: string, fn: () => Promise<T> | T, meta?: LogData): Promise<T>;
/**
 * Express/connect-style middleware: runs the request inside a fresh timing store
 * and emits the accumulated measures as a `Server-Timing` header on the way out.
 */
declare function timingMiddleware(_req: IncomingMessage, res: ServerResponse, next: () => void): void;

export { type TimingStore, profile, record, serializeServerTiming, time, timingMiddleware, timingStore };
