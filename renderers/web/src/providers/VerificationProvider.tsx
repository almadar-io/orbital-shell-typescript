'use client';
/**
 * VerificationProvider
 *
 * Wires the verification registry to the event bus: intercepts the lifecycle events
 * (`{traitName}:DISPATCH`, `{traitName}:{event}:SUCCESS`, `{traitName}:{event}:ERROR`) and records
 * transitions via `recordTransition()`, then calls `bindEventBus()` and `bindTraitStateGetter()` to populate
 * `window.__orbitalVerification` for Playwright/automation.
 *
 * @packageDocumentation
 */

import React, { useEffect, useRef, type ReactNode } from 'react';
import type { BusEvent, FieldValue, EventPayload } from '@almadar/core';
import { useEventBus } from '../core';
import { useTranslate } from '../core';
import {
  recordTransition,
  bindEventBus,
  bindTraitStateGetter,
  registerCheck,
  verifierAttached,
  type EffectTrace,
} from '../lib/verificationRegistry';
import { createLogger } from '@almadar/logger';

const log = createLogger('almadar:verify');

// ============================================================================
// Types
// ============================================================================

export interface VerificationProviderProps {
  children: ReactNode;
  /** Enable verification wiring (default: true in dev, false in prod) */
  enabled?: boolean;
  /** Optional trait state getter for compiled apps (maps traitName → currentState) */
  traitStateGetter?: (traitName: string) => string | undefined;
}

// ============================================================================
// Pending dispatch tracker
// ============================================================================

interface PendingDispatch {
  traitName: string;
  event: string;
  from: string | undefined;
  timestamp: number;
}

// ============================================================================
// Event type pattern matchers
// ============================================================================

const DISPATCH_SUFFIX = ':DISPATCH';
const SUCCESS_SUFFIX = ':SUCCESS';
const ERROR_SUFFIX = ':ERROR';

/**
 * Parse a lifecycle event type into its components.
 *
 * - `"{traitName}:DISPATCH"` → { kind: 'dispatch', traitName }
 * - `"{traitName}:{event}:SUCCESS"` → { kind: 'success', traitName, event }
 * - `"{traitName}:{event}:ERROR"` → { kind: 'error', traitName, event }
 */
function parseLifecycleEvent(type: string): {
  kind: 'dispatch' | 'success' | 'error';
  traitName: string;
  event?: string;
} | null {
  if (type.endsWith(DISPATCH_SUFFIX)) {
    const traitName = type.slice(0, -DISPATCH_SUFFIX.length);
    if (traitName) return { kind: 'dispatch', traitName };
  } else if (type.endsWith(SUCCESS_SUFFIX)) {
    const rest = type.slice(0, -SUCCESS_SUFFIX.length);
    const colonIdx = rest.indexOf(':');
    if (colonIdx > 0) {
      return {
        kind: 'success',
        traitName: rest.slice(0, colonIdx),
        event: rest.slice(colonIdx + 1),
      };
    }
  } else if (type.endsWith(ERROR_SUFFIX)) {
    const rest = type.slice(0, -ERROR_SUFFIX.length);
    const colonIdx = rest.indexOf(':');
    if (colonIdx > 0) {
      return {
        kind: 'error',
        traitName: rest.slice(0, colonIdx),
        event: rest.slice(colonIdx + 1),
      };
    }
  }
  return null;
}

/**
 * Map the compiled path's raw `effectResults` bus payload (persist / fetch /
 * call-service outcomes forwarded from the server) onto `EffectTrace[]`.
 * Exported for unit testing — pure, no React/event-bus dependency.
 *
 * The server's `EffectResult` (`OrbitalServerRuntime.ts`) writes
 * `entityType` — not `entity` — plus `action` / `data.id` / `success` /
 * `denied`; reading only `er['entity']` (never populated) dropped all of
 * that, so a denied or failed persist read back here as a plain 'executed'
 * effect with no entity name.
 */
export function mapServerEffectResults(effectResults: ReadonlyArray<EventPayload>): EffectTrace[] {
  return effectResults.map((er): EffectTrace => {
    const target = er['entityType'] ?? er['entity'] ?? er['service'];
    const entityName = typeof target === 'string' && target !== '' ? target : undefined;
    const rawAction = er['action'];
    const action = rawAction === 'create' || rawAction === 'update'
      || rawAction === 'delete' || rawAction === 'batch'
      ? rawAction
      : undefined;
    const data = er['data'];
    const resultId = data !== null && typeof data === 'object' && !Array.isArray(data)
      && typeof (data as EventPayload)['id'] === 'string'
      ? (data as EventPayload)['id'] as string
      : undefined;
    const denied = er['denied'] === true;
    const success = er['success'] !== false;
    const outcome: EffectTrace['outcome'] = denied ? 'denied' : success ? 'success' : 'failed';
    return {
      type: String(er['type'] ?? er['effect'] ?? 'server-effect'),
      ...(entityName !== undefined ? { entityName } : {}),
      ...(action !== undefined ? { action } : {}),
      ...(resultId !== undefined ? { resultId } : {}),
      outcome,
      args: entityName !== undefined ? [entityName] : [],
      status: outcome === 'success' ? 'executed' as const : 'failed' as const,
      error: er['error'] as string | undefined,
    };
  });
}

// ============================================================================
// Component
// ============================================================================

/**
 * VerificationProvider — wires the verification registry to the event bus. Renders children unchanged.
 */
export function VerificationProvider({
  children,
  enabled,
  traitStateGetter,
}: VerificationProviderProps): React.ReactElement {
  // Enable when: explicitly told (`enabled`), OR a verifier set the
  // `__ALMADAR_VERIFY__` window flag (Playwright/automation — this is what gets
  // `__orbitalVerification.sendEvent` attached, via bindEventBus below), OR
  // we're a non-production Node build. The `process` heuristic alone is
  // Node-centric and is always false in the browser bundle (`process` is
  // undefined), which is why compiled-shell dispatch was silently never wired.
  const verifyFlag = verifierAttached();
  const isEnabled =
    enabled ??
    (verifyFlag || (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'));
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const tRef = useRef(t);
  tRef.current = t;
  const pendingRef = useRef<Map<string, PendingDispatch>>(new Map());

  // ── Compiled app path: intercept lifecycle events via onAny ──
  useEffect(() => {
    if (!isEnabled) return;
    if (!eventBus.onAny) return;

    const verificationProviderLifecycleListener = (evt: BusEvent) => {
      const parsed = parseLifecycleEvent(evt.type);
      if (!parsed) return;
      log.debug('lifecycle:event', { kind: parsed.kind, traitName: parsed.traitName, event: parsed.event, type: evt.type });

      const payload = evt.payload ?? {};

      if (parsed.kind === 'dispatch') {
        // Store pending dispatch to correlate with SUCCESS/ERROR
        const key = `${parsed.traitName}:${String(payload['event'] ?? '')}`;
        pendingRef.current.set(key, {
          traitName: parsed.traitName,
          event: String(payload['event'] ?? ''),
          from: payload['currentState'] as string | undefined,
          timestamp: evt.timestamp,
        });
      } else if (parsed.kind === 'success' && parsed.event) {
        const key = `${parsed.traitName}:${parsed.event}`;
        const pending = pendingRef.current.get(key);
        pendingRef.current.delete(key);

        const newState = (payload['newState'] ?? payload['state'] ?? 'unknown') as string;

        // Extract client effects from payload
        const clientEffectsArr = Array.isArray(payload['clientEffects'])
          ? payload['clientEffects'] as Array<EventPayload>
          : [];
        const effects: EffectTrace[] = clientEffectsArr.map((e) => ({
          type: String(e['type'] ?? 'unknown'),
          args: Array.isArray(e['args']) ? e['args'] : [],
          status: 'executed' as const,
        }));

        // Extract effectResults (persist, fetch, call-service results from
        // server). The server's `EffectResult` writes `entityType` — not
        // `entity` — plus `action`/`data.id`/`success`/`denied`; dropping
        // those left a denied or failed persist reading as a plain
        // 'executed' effect with no entity name in the verification trace.
        const effectResultsRaw = Array.isArray(payload['effectResults'])
          ? payload['effectResults'] as Array<EventPayload>
          : [];
        effects.push(...mapServerEffectResults(effectResultsRaw));

        // Build data entity counts from response data
        const dataEntities: Record<string, number> = {};
        const responseData = payload['data'] as Record<string, FieldValue[]> | undefined;
        if (responseData && typeof responseData === 'object') {
          for (const [entityName, records] of Object.entries(responseData)) {
            dataEntities[entityName] = Array.isArray(records) ? records.length : 0;
          }
        }

        // Extract emittedEvents — server-side cascade events fired by
        // declared `emit.success` / `emit.failure` blocks on persist /
        // fetch / call-service / ref effects. The compiled handler
        // returns these as `Array<{event, payload, source}>`; verifiers
        // consume them as `string[]` (just the event name).
        const emittedEventsRaw = Array.isArray(payload['emittedEvents'])
          ? (payload['emittedEvents'] as Array<EventPayload>)
          : [];
        const emittedEvents: string[] = emittedEventsRaw
          .map((e) => (typeof e.event === 'string' ? e.event : null))
          .filter((e): e is string => e !== null);
        const emitted = emittedEventsRaw.flatMap((e) => {
          if (typeof e.event !== 'string') return [];
          const p = e['payload'];
          return [{ event: e.event, ...(p !== null && typeof p === 'object' && !Array.isArray(p) && { payload: p as EventPayload }) }];
        });

        recordTransition({
          traitName: parsed.traitName,
          from: pending?.from ?? (payload['currentState'] as string | undefined) ?? newState,
          to: newState,
          event: parsed.event,
          effects,
          serverResponse: {
            orbitalName: parsed.traitName,
            success: true,
            ...(typeof payload['transitioned'] === 'boolean' && { transitioned: payload['transitioned'] }),
            clientEffects: clientEffectsArr.length,
            dataEntities,
            emittedEvents,
            emitted,
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        });
        log.debug('transition:success', { trait: parsed.traitName, event: parsed.event, from: pending?.from, to: newState, effectCount: effects.length });
      } else if (parsed.kind === 'error' && parsed.event) {
        const key = `${parsed.traitName}:${parsed.event}`;
        const pending = pendingRef.current.get(key);
        pendingRef.current.delete(key);

        const errorMsg = (payload['error'] ?? tRef.current('verification.unknownError')) as string;

        const fromState = pending?.from ?? (payload['currentState'] as string | undefined) ?? 'unknown';
        recordTransition({
          traitName: parsed.traitName,
          from: fromState,
          to: fromState, // state didn't change on error
          event: parsed.event,
          effects: [{
            type: 'server-call',
            args: [],
            status: 'failed',
            error: errorMsg,
          }],
          serverResponse: {
            orbitalName: parsed.traitName,
            success: false,
            transitioned: false,
            clientEffects: 0,
            dataEntities: {},
            emittedEvents: [],
            error: errorMsg,
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        });
        log.warn('transition:error', { trait: parsed.traitName, event: parsed.event, from: fromState, error: errorMsg });
      }
    };
    // Preserve the listener's name through Vite/Rollup minification so
    // EventBusProvider's per-listener log can identify this onAny
    // subscriber by its source-level name. Direct `const fn = (...)`
    // names are mangled by minifiers; a runtime defineProperty assigns
    // the name string at execution time and survives bundling.
    Object.defineProperty(verificationProviderLifecycleListener, 'name', {
      value: 'VerificationProvider:lifecycle',
    });
    const unsub = eventBus.onAny(verificationProviderLifecycleListener);

    registerCheck(
      'verification-provider',
      'VerificationProvider active (compiled path)',
      'pass',
    );

    return unsub;
  }, [isEnabled, eventBus]);

  // ── Bind event bus for Playwright sendEvent() ──
  useEffect(() => {
    if (!isEnabled) return;
    bindEventBus(eventBus);
  }, [isEnabled, eventBus]);

  // ── Bind trait state getter for Playwright getTraitState() ──
  useEffect(() => {
    if (!isEnabled) return;

    if (traitStateGetter) bindTraitStateGetter(traitStateGetter);
  }, [isEnabled, traitStateGetter]);

  return <>{children}</>;
}

VerificationProvider.displayName = 'VerificationProvider';
