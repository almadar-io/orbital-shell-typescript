export { L as LogData, a as LogFormat, b as LogLevel, c as LogOutput, d as Logger, e as configureLogOutput, f as createLogger, g as generateCorrelationId, h as getEffectiveLevel, i as getKnownNamespaces, j as getLogLevel, k as getLogOutput, l as getNamespaceLevel, m as getNamespaceLevels, n as isLogLevelEnabled, s as setLogLevel, o as setNamespaceLevel, t as timeCall } from './logger-A7Kdh2zn.js';
import '@almadar/core';

/**
 * Runtime namespace filter override.
 *
 * Read on every `Logger` method invocation so authors can flip filtering
 * from a browser console (or a Node REPL) without rebuilding:
 *
 *   globalThis.__ALMADAR_DEBUG__ = 'almadar:runtime:sm';   // narrow
 *   globalThis.__ALMADAR_DEBUG__ = '*';                    // verbose
 *   globalThis.__ALMADAR_DEBUG__ = '';                     // silence all DEBUG/INFO
 *   delete globalThis.__ALMADAR_DEBUG__;                   // fall back to env filter
 *
 * `undefined` = no override (env `ALMADAR_DEBUG` wins).
 * `'' (empty)` = explicit silence (overrides env).
 * Any non-empty string = comma-separated patterns, same wildcard semantics
 *                       as the env filter (`'*'`, `'almadar:*'`,
 *                       `'almadar:runtime:*'`, exact match).
 */
declare global {
    var __ALMADAR_DEBUG__: string | undefined;
}
declare function getRuntimeNamespaceFilter(): string | undefined;
declare function setRuntimeNamespaceFilter(value: string | undefined): void;

/**
 * Optional localStorage persistence for the runtime knobs.
 *
 * Disabled by default — must be explicitly enabled by the consumer
 * (typically once at app entry). When enabled:
 * - On enable: reads the stored prefs blob and applies it via
 *   `setRuntimeNamespaceFilter` / `setLogLevel` / `setNamespaceLevel`.
 * - On every config change (via the observer hook): writes the current
 *   state back to localStorage under the same key.
 *
 * Browser-only. In Node (no `localStorage`), enable is a no-op.
 */
/**
 * Enable localStorage-backed persistence for the runtime knobs.
 *
 * Restores any previously saved prefs and starts mirroring future
 * mutations of namespace filter / level / namespace-level overrides
 * back to localStorage. Idempotent: subsequent calls reset the key and
 * re-bind the observer.
 *
 * @param key  localStorage key (default `'almadar:logger:prefs'`).
 */
declare function enableLogPersistence(key?: string): void;
/** Stop mirroring config changes to localStorage. Does NOT clear stored prefs. */
declare function disableLogPersistence(): void;
/** Clear the stored prefs blob (and stop persistence). */
declare function clearLogPersistence(key?: string): void;

/**
 * Config-change observers. Persistence and debug-UI consumers subscribe
 * here so they can react to any mutation of the logger's runtime
 * configuration (level, namespace filter, per-namespace overrides).
 */
type Observer = () => void;
declare function onLogConfigChange(fn: Observer): () => void;

export { clearLogPersistence, disableLogPersistence, enableLogPersistence, getRuntimeNamespaceFilter, onLogConfigChange, setRuntimeNamespaceFilter };
