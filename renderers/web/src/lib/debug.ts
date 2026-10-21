/**
 * Legacy debug helpers, now routed through `@almadar/logger`.
 *
 * The variadic `debug(...args)` shape is preserved for the many existing
 * call sites (Form.tsx, RelationSelect.tsx, game helpers, etc.), but the
 * gate is no longer a separate localStorage check — every helper here
 * runs through the same priority/namespace gate the rest of the codebase
 * uses. `setLogLevel('WARN')` silences them. `globalThis.__ALMADAR_DEBUG__`
 * filters them by namespace.
 *
 * Namespace: `almadar:ui:debug` (plus per-area suffixes for input,
 * collision, physics, game-state).
 */

import { createLogger, isLogLevelEnabled, type LogLevel } from '@almadar/logger';

const NAMESPACE = 'almadar:ui:debug';
const log = createLogger(NAMESPACE);

const inputLog = createLogger('almadar:ui:debug:input');
const collisionLog = createLogger('almadar:ui:debug:collision');
const physicsLog = createLogger('almadar:ui:debug:physics');
const gameStateLog = createLogger('almadar:ui:debug:game-state');

function gateEnabled(level: LogLevel, ns = NAMESPACE): boolean {
  return isLogLevelEnabled(level, ns);
}

export function isDebugEnabled(): boolean {
  return gateEnabled('DEBUG');
}

/**
 * Variadic legacy debug. The first arg is the message; the rest is
 * stringified into the LogData. Routes through the shared gate.
 */
// eslint-disable-next-line almadar/no-unknown-type
export function debug(...args: unknown[]): void {
  if (!gateEnabled('DEBUG')) return;
  const [first, ...rest] = args;
  const message = typeof first === 'string' ? first : '<debug>';
  if (rest.length === 0 && typeof first === 'string') {
    log.debug(message);
  } else {
    log.debug(message, { args: rest.length > 0 ? formatArgs(rest) : formatArgs([first]) });
  }
}

export function debugGroup(label: string): void {
  // Group / groupEnd have no logger equivalent; preserve via raw console
  // calls but gate through the logger so `setLogLevel('WARN')` silences.
  if (gateEnabled('DEBUG')) console.group(`[${NAMESPACE}] ${label}`);
}

export function debugGroupEnd(): void {
  if (gateEnabled('DEBUG')) console.groupEnd();
}

// eslint-disable-next-line almadar/no-unknown-type
export function debugWarn(...args: unknown[]): void {
  if (!gateEnabled('WARN')) return;
  const [first, ...rest] = args;
  const message = typeof first === 'string' ? first : '<warn>';
  log.warn(message, rest.length > 0 ? { args: formatArgs(rest) } : undefined);
}

// eslint-disable-next-line almadar/no-unknown-type
export function debugError(...args: unknown[]): void {
  if (!gateEnabled('ERROR')) return;
  const [first, ...rest] = args;
  const message = typeof first === 'string' ? first : '<error>';
  log.error(message, rest.length > 0 ? { args: formatArgs(rest) } : undefined);
}

// eslint-disable-next-line almadar/no-unknown-type
export function debugTable(data: unknown): void {
  // console.table has no logger equivalent; gate then pass through.
  if (gateEnabled('DEBUG')) console.table(data);
}

export function debugTime(label: string): void {
  if (gateEnabled('DEBUG')) console.time(`[${NAMESPACE}] ${label}`);
}

export function debugTimeEnd(label: string): void {
  if (gateEnabled('DEBUG')) console.timeEnd(`[${NAMESPACE}] ${label}`);
}

// =============================================================================
// Game-specific debug utilities — each routes through its own namespace so
// `setNamespaceLevel('almadar:ui:debug:input', 'WARN')` can quiet just one.
// =============================================================================

// eslint-disable-next-line almadar/no-unknown-type
export function debugInput(inputType: string, data: unknown): void {
  inputLog.debug(inputType, { data: formatArgs([data]) });
}

export function debugCollision(
  entityA: { id?: string; type?: string },
  entityB: { id?: string; type?: string },
  // eslint-disable-next-line almadar/no-unknown-type
  details?: unknown,
): void {
  collisionLog.debug('collision', () => ({
    a: entityA.type ?? entityA.id ?? null,
    b: entityB.type ?? entityB.id ?? null,
    details: details === undefined ? null : formatArgs([details]),
  }));
}

// eslint-disable-next-line almadar/no-unknown-type
export function debugPhysics(entityId: string, physics: unknown): void {
  physicsLog.debug('physics', { entityId, data: formatArgs([physics]) });
}

// eslint-disable-next-line almadar/no-unknown-type
export function debugGameState(stateName: string, value: unknown): void {
  gameStateLog.debug(stateName, { value: formatArgs([value]) });
}

// =============================================================================
// Internal: pack arbitrary `unknown` args into a LogMeta-compatible shape.
// LogMeta accepts strings, numbers, booleans, null, undefined, Errors, nested
// records, and arrays of the same. For everything else we stringify so we
// never throw from inside the gate.
// =============================================================================

type LogMetaPrimitive = string | number | boolean | null | undefined | Error;
type LogMetaValue =
  | LogMetaPrimitive
  | { [k: string]: LogMetaValue }
  | readonly LogMetaValue[];

// eslint-disable-next-line almadar/no-unknown-type
function formatArgs(values: readonly unknown[]): LogMetaValue {
  if (values.length === 1) return toLogMetaValue(values[0]);
  return values.map(toLogMetaValue);
}

// eslint-disable-next-line almadar/no-unknown-type
function toLogMetaValue(v: unknown): LogMetaValue {
  if (v === null || v === undefined) return v;
  if (v instanceof Error) return v;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return v as LogMetaValue;
  if (Array.isArray(v)) return v.map(toLogMetaValue);
  if (t === 'object') {
    const out: Record<string, LogMetaValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, LogMetaValue>)) {
      out[k] = toLogMetaValue(val);
    }
    return out;
  }
  // Functions, symbols, bigints — stringify so we never throw from logging.
  return String(v);
}
