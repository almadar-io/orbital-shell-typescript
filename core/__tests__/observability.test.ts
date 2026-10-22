/**
 * A running app's log lines are one JSON object each (Cloud Logging's structured shape). A line
 * may carry a call record: one call the app made to a store, an integration, a queue or another
 * server. The deployment view builds its topology from these lines, so the reader must accept
 * exactly the declared shape and nothing else.
 */
import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../src/types/json.js';
import { isCallRecord, isStructuredLogEntry } from '../src/types/observability.js';

const call: JsonValue = { kind: 'db', service: 'firestore', op: 'list:Order', durationMs: 12.5, ok: true };
const entry: JsonValue = {
  severity: 'INFO',
  time: '2026-09-29T06:00:00.000Z',
  namespace: 'almadar:server:data',
  message: 'list',
  appId: 'app-1',
  deploymentCommit: 'abc123',
  call,
};

describe('isCallRecord', () => {
  it('accepts a complete record, and a failed one with its error', () => {
    expect(isCallRecord(call)).toBe(true);
    expect(isCallRecord({ kind: 'external', service: 'stripe', op: 'charge', durationMs: 0, ok: false, error: '402' })).toBe(true);
  });

  it('control: refuses an unknown kind, a negative duration, a non-boolean ok and a missing field', () => {
    expect(isCallRecord({ kind: 'cache', service: 's', op: 'o', durationMs: 1, ok: true })).toBe(false);
    expect(isCallRecord({ kind: 'db', service: 's', op: 'o', durationMs: -1, ok: true })).toBe(false);
    expect(isCallRecord({ kind: 'db', service: 's', op: 'o', durationMs: 1, ok: 'yes' })).toBe(false);
    expect(isCallRecord({ kind: 'db', service: 's', durationMs: 1, ok: true })).toBe(false);
  });

  it('edge: an error on a successful call is refused', () => {
    expect(isCallRecord({ kind: 'db', service: 's', op: 'o', durationMs: 1, ok: true, error: 'x' })).toBe(false);
  });
});

describe('isStructuredLogEntry', () => {
  it('accepts a line with a call record and its deployment context', () => {
    expect(isStructuredLogEntry(entry)).toBe(true);
  });

  it('accepts a plain line with no call and no context', () => {
    expect(isStructuredLogEntry({ severity: 'WARNING', time: '2026-09-29T06:00:00.000Z', namespace: 'n', message: 'm' })).toBe(true);
  });

  it('control: refuses a console-format severity, a malformed call, and a non-object', () => {
    expect(isStructuredLogEntry({ severity: 'WARN', time: 't', namespace: 'n', message: 'm' })).toBe(false);
    expect(isStructuredLogEntry({ severity: 'INFO', time: 't', namespace: 'n', message: 'm', call: { kind: 'db' } })).toBe(false);
    expect(isStructuredLogEntry('INFO m')).toBe(false);
    expect(isStructuredLogEntry(null)).toBe(false);
  });
});
