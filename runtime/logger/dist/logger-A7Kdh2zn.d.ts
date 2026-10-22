import { LogMeta, LogContext, StructuredLogEntry, CallRecord } from '@almadar/core';

/**
 * Almadar structured logger with three-layer gating.
 *
 * Layer 1 (compile-time): `MIN_PRIORITY` derived from `NODE_ENV` + `LOG_LEVEL`.
 *                         Production defaults to WARN, dev to DEBUG.
 *                         Mutable at runtime via `setLogLevel`.
 * Layer 2 (env):          `ALMADAR_DEBUG="ns1,ns2:*"` namespace allowlist.
 * Layer 3 (runtime):      `globalThis.__ALMADAR_DEBUG__` re-read on each call;
 *                         overrides layer 2 when set.
 *
 * Per-namespace level overrides (`setNamespaceLevel`) compose between
 * layers 1 and 2: a namespace can carry its own minimum priority that
 * takes precedence over the global level. They are seeded from
 * `ALMADAR_LOG_LEVELS="almadar:integrations:*=info,almadar:llm=debug"`;
 * an exact namespace beats every `prefix:*`, and the longest prefix wins.
 *
 * Data is typed via `LogMeta` from `@almadar/core` — strict, recursive,
 * no `unknown`. The `LogData` alias also accepts a `() => LogMeta` thunk
 * that is only invoked after the priority gate passes, so call sites in
 * hot paths can defer payload construction.
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
/** Public data argument: either eager `LogMeta` or a lazy thunk that returns one. */
type LogData = LogMeta | (() => LogMeta);
interface Logger {
    debug(message: string, data?: LogData, correlationId?: string): void;
    info(message: string, data?: LogData, correlationId?: string): void;
    warn(message: string, data?: LogData, correlationId?: string): void;
    error(message: string, data?: LogData, correlationId?: string): void;
    /** Record one call the app made (a store, an integration, a queue, another server). */
    call(record: CallRecord): void;
}
/**
 * `console` (default): the prefixed console lines. `json`: one Cloud Logging line per entry on
 * stdout, carrying the deployment context; call records are telemetry there and pass every filter.
 */
type LogFormat = 'console' | 'json';
interface LogOutput {
    format: LogFormat;
    context: LogContext;
    /** The current request's context, for a process serving many apps; overrides `context` when it returns one. */
    contextOf?: () => LogContext | undefined;
    /** Also handed every structured entry (json format), e.g. to keep a local copy per app. */
    sink?: (entry: StructuredLogEntry) => void;
}
declare function getLogLevel(): LogLevel;
declare function setLogLevel(level: LogLevel): void;
declare function setNamespaceLevel(namespace: string, level: LogLevel | null): void;
declare function getNamespaceLevel(namespace: string): LogLevel | undefined;
declare function getNamespaceLevels(): ReadonlyMap<string, LogLevel>;
/** The lowest level `namespace` fires at: its own level, else the most specific `prefix:*` level, else the global level. */
declare function getEffectiveLevel(namespace: string): LogLevel;
/** Every namespace a logger has been created for in this process, sorted. */
declare function getKnownNamespaces(): string[];
declare function isLogLevelEnabled(level: LogLevel, namespace: string): boolean;
declare function configureLogOutput(next: {
    format: LogFormat;
    context?: LogContext;
    contextOf?: () => LogContext | undefined;
    sink?: (entry: StructuredLogEntry) => void;
}): void;
declare function getLogOutput(): LogOutput;
declare function createLogger(namespace: string): Logger;
declare function generateCorrelationId(): string;
/** Run `fn` as one call and record it on `logger`: its duration, and its error when it throws (then rethrows). */
declare function timeCall<T>(logger: Logger, call: Pick<CallRecord, 'kind' | 'service' | 'op'>, fn: () => Promise<T>): Promise<T>;

export { type LogData as L, type LogFormat as a, type LogLevel as b, type LogOutput as c, type Logger as d, configureLogOutput as e, createLogger as f, generateCorrelationId as g, getEffectiveLevel as h, getKnownNamespaces as i, getLogLevel as j, getLogOutput as k, getNamespaceLevel as l, getNamespaceLevels as m, isLogLevelEnabled as n, setNamespaceLevel as o, setLogLevel as s, timeCall as t };
