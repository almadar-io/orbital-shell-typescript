/**
 * The view's side of a dispatch the in-process kernel already ran: report its executed hops to the observer,
 * mirror its states, rows and sticky callsite payloads into the `CircuitStore`, then notify subscribers.
 * One implementation for every response the kernel produces (a dispatch, a mount seed, a posted leg's fold,
 * a tick frame).
 */
import type { OrbitalEventResponse } from '@almadar/core';
import type { LocalFoldKernel } from './client-kernel.js';
import type { CircuitStore } from './circuit-store.js';
import type { TransitionObserver } from './trait-types.js';

export function mirrorResponse(store: CircuitStore, frameKeyOf: (trait: string) => string | undefined, response: OrbitalEventResponse): void {
  for (const [trait, state] of Object.entries(response.states)) {
    if (store.states.getState(trait)?.currentState !== state) store.states.seedState(trait, state);
  }
  for (const [trait, row] of Object.entries(response.entityByTrait ?? {})) {
    const frameKey = frameKeyOf(trait);
    if (frameKey === undefined) continue;
    store.frames.set(frameKey, { ...(store.frames.get(frameKey) ?? {}), ...row });
  }
  for (const effect of response.clientEffectsByTrait ?? []) {
    if (effect.callsitePayload !== undefined) store.callsitePayloads.set(effect.traitName, effect.callsitePayload);
  }
}

export function traceResponse(observer: TransitionObserver | undefined, response: OrbitalEventResponse): void {
  if (observer === undefined) return;
  for (const hop of response.transitions ?? []) {
    observer.onTransition({
      traitName: hop.trait,
      from: hop.from,
      to: hop.to,
      event: hop.event,
      ...(hop.firedArm !== undefined ? { firedArm: hop.firedArm } : {}),
      ...(hop.guardResult !== undefined ? { guardResult: hop.guardResult } : {}),
      effects: hop.effects,
      ...(hop.observed !== undefined ? { observed: hop.observed } : {}),
    });
  }
}

export interface LocalFoldOptions {
  store: CircuitStore;
  frameKeyOf(trait: string): string | undefined;
  observer?: TransitionObserver;
}

export function createLocalFold(opts: LocalFoldOptions): LocalFoldKernel {
  return {
    foldLocalResponse: async (response, traceHops, notify) => {
      if (traceHops) traceResponse(opts.observer, response);
      mirrorResponse(opts.store, opts.frameKeyOf, response);
      if (notify) opts.store.notify();
    },
  };
}
