/**
 * Observability contract for a running app: one structured log line per entry (Cloud Logging's
 * JSON shape), optionally carrying a call record for one call the app made. `@almadar/logger`
 * writes these; a deployment's topology is read back from them.
 *
 * @packageDocumentation
 */

import { isJsonObject, type JsonObject, type JsonValue } from './json.js';

/** What a call reached: a browser client, another server, a data store, a queue, or an external service. */
export type CallKind = 'client' | 'server' | 'db' | 'queue' | 'external';

export const CALL_KINDS: readonly CallKind[] = ['client', 'server', 'db', 'queue', 'external'];

/** One call an app made, with its outcome. `error` is present only on a failed call. */
export interface CallRecord {
  kind: CallKind;
  /** The service reached: a data backend (`firestore`), an integration (`stripe`), a route prefix. */
  service: string;
  /** The operation: `list:Order`, `charge`, `POST /api/orbitals/:orbital/events`. */
  op: string;
  durationMs: number;
  ok: boolean;
  error?: string;
}

/** Which deployment a line came from. */
export interface LogContext {
  appId?: string;
  deploymentCommit?: string;
}

/** Cloud Logging severities used by structured lines. */
export type LogSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export const LOG_SEVERITIES: readonly LogSeverity[] = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];

/** One structured log line. */
export interface StructuredLogEntry extends LogContext {
  severity: LogSeverity;
  time: string;
  namespace: string;
  message: string;
  data?: JsonObject;
  call?: CallRecord;
}

function isCallKind(value: JsonValue | undefined): value is CallKind {
  return typeof value === 'string' && CALL_KINDS.some((k) => k === value);
}

function isSeverity(value: JsonValue | undefined): value is LogSeverity {
  return typeof value === 'string' && LOG_SEVERITIES.some((s) => s === value);
}

function optionalString(value: JsonValue | undefined): boolean {
  return value === undefined || typeof value === 'string';
}

/** True when `value` is a complete call record; a successful call never carries an error. */
export function isCallRecord(value: JsonValue | undefined): value is JsonObject & CallRecord {
  if (value === undefined || !isJsonObject(value)) return false;
  const { kind, service, op, durationMs, ok, error } = value;
  if (!isCallKind(kind) || typeof service !== 'string' || typeof op !== 'string') return false;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return false;
  if (typeof ok !== 'boolean' || !optionalString(error)) return false;
  return !(ok && error !== undefined);
}

/** True when `value` is a structured log line, with a well-formed call record if it carries one. */
export function isStructuredLogEntry(value: JsonValue): value is JsonObject & StructuredLogEntry {
  if (!isJsonObject(value)) return false;
  const { severity, time, namespace, message, data, call, appId, deploymentCommit } = value;
  if (!isSeverity(severity) || typeof time !== 'string' || typeof namespace !== 'string' || typeof message !== 'string') return false;
  if (data !== undefined && !isJsonObject(data)) return false;
  if (call !== undefined && !isCallRecord(call)) return false;
  return optionalString(appId) && optionalString(deploymentCommit);
}
