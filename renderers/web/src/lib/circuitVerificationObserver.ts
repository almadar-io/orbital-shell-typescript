/**
 * Circuit verification observer — W5b (docs/Almadar_Runtime_Stateless_Stateful_PLAN.md §5.1).
 *
 * The ONE `TransitionObserver` implementation: the kernel client reports each committed hop (and each
 * rollback) to it, and it forwards them into this package's verification registries.
 *
 * @packageDocumentation
 */
import type { TransitionObserver } from '../index';
import type { EffectTrace, OrbitalEventResponse, SExpr } from '@almadar/core';
import { recordServerResponse, recordTransition, serverEffectTraces } from './verificationRegistry';

/** The shape passed to `TransitionObserver.onTransition`. */
type CircuitTransitionTrace = Parameters<TransitionObserver['onTransition']>[0];

/**
 * Build one `TransitionObserver` that forwards every committed hop to
 * `recordTransition`. The observer's trace shape carries `type`/`args`/
 * `status`/`error`/`durationMs` per effect — everything `EffectTrace`
 * needs except the real per-effect outcome (`entityName`/`action`/
 * `resultId`/`outcome`), which the pre-kernel hook reconstructed from the
 * offline-preview persistence handler's own result stream
 * (`overlayServerEffectResults`). The kernel's effect stage doesn't expose
 * that stream to the observer today, so those fields stay unset here —
 * every trace's declared shape (traitName/from/to/event/effects) is
 * unaffected, only the persist-outcome enrichment is not yet wired.
 */
export function createCircuitVerificationObserver(): TransitionObserver {
  return {
    onTransition(trace: CircuitTransitionTrace): void {
      const effects: EffectTrace[] = trace.effects.map((effect) => ({
        type: effect.type,
        args: effect.args,
        status: effect.status,
        ...(effect.error !== undefined ? { error: effect.error } : {}),
        ...(effect.durationMs !== undefined ? { durationMs: effect.durationMs } : {}),
      }));
      recordTransition({
        traitName: trace.traitName,
        from: trace.from,
        to: trace.to,
        event: trace.event,
        effects,
        timestamp: Date.now(),
        ...(trace.firedArm !== undefined ? { firedArm: trace.firedArm } : {}),
        ...(trace.guardResult !== undefined ? { guardResult: trace.guardResult } : {}),
        ...(trace.observed !== undefined ? { observed: trace.observed } : {}),
      });
    },
  };
}

/** What one client-kernel dispatch came back with: its response, or the
 *  error it threw before producing one. */
export type DispatchVerdict = { response: OrbitalEventResponse } | { error: Error | string };

/**
 * Record the runtime's own verdict for one dispatch on the verification
 * timeline (the `server:<Orbital>` entry the verifier matches by event), so a
 * rejected or throwing dispatch is visible to the walk — a self-loop that
 * throws still leaves its trait in `to`.
 */
export function recordDispatchVerdict(orbitalName: string, event: string, verdict: DispatchVerdict): void {
  if ('error' in verdict) {
    recordServerResponse(orbitalName, event, {
      success: false,
      clientEffects: 0,
      dataEntities: {},
      emittedEvents: [],
      error: verdict.error instanceof Error ? `${verdict.error.name}: ${verdict.error.message}` : verdict.error,
    });
    return;
  }
  const { response } = verdict;
  const dataEntities: Record<string, number> = {};
  for (const [entity, rows] of Object.entries(response.data ?? {})) dataEntities[entity] = rows.length;
  const effectFailures = (response.rejections ?? [])
    .filter((r) => r.code === 'effect-failed')
    .map((r) => `${r.trait ?? orbitalName}.${r.event ?? event}: ${r.error ?? 'effect failed'}`);
  const error = [...(response.error !== undefined ? [response.error] : []), ...effectFailures].join('; ');
  recordServerResponse(orbitalName, event, {
    success: response.success && effectFailures.length === 0,
    transitioned: response.transitioned,
    clientEffects: response.clientEffectsByTrait?.length ?? 0,
    dataEntities,
    emittedEvents: response.emittedEvents.map((e) => e.event),
    emitted: response.emittedEvents.map((e) => (e.payload !== undefined ? { event: e.event, payload: e.payload } : { event: e.event })),
    ...(error !== '' ? { error } : {}),
    effectResults: serverEffectTraces(response.effectResults),
  });
}
