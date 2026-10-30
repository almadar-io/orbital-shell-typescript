/**
 * The view's side of a dispatch the in-process kernel already ran: report its executed hops to the observer,
 * paint its states, frame delta and sticky callsite payloads into the `CircuitStore`, then notify subscribers.
 * One implementation for every response the kernel produces (a dispatch, a mount seed, a posted leg's fold,
 * a tick frame).
 */
import type { EventResponse } from '@almadar/core';
import type { FrameDelta } from '@almadar/core/kernel-wire';
import type { LocalFoldKernel } from './client-kernel.js';
import type { CircuitStore } from './circuit-store.js';
import type { TransitionObserver } from './trait-types.js';

/** A snapshot of the kernel's frames for a painter at `since` (the kernel's `framesSince`). */
export type FramesSince = (since: number) => FrameDelta;

/** Paint a response's states. Rows are the kernel's frame delta, painted by [`paintFrames`]. */
export function paintStates(store: CircuitStore, response: EventResponse): void {
  for (const [trait, state] of Object.entries(response.states)) {
    if (store.states.getState(trait)?.currentState !== state) store.states.seedState(trait, state);
  }
}

/** Paint the kernel's frame delta; on a version gap, ask the kernel for the snapshot and paint that. */
export function paintFrames(store: CircuitStore, delta: FrameDelta | undefined, framesSince: FramesSince): void {
  if (delta === undefined) return;
  if (store.applyFrames(delta) === 'gap') store.applyFrames(framesSince(store.frameVersion));
}

/** Paint a response the in-process kernel produced: its states, payloads and frames. */
export function paintResponse(store: CircuitStore, framesSince: FramesSince, response: EventResponse): void {
  paintStates(store, response);
  paintFrames(store, response.frames, framesSince);
}

export function traceResponse(observer: TransitionObserver | undefined, response: EventResponse): void {
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
  framesSince: FramesSince;
  observer?: TransitionObserver;
}

export function createLocalFold(opts: LocalFoldOptions): LocalFoldKernel {
  return {
    foldLocalResponse: async (response, traceHops, notify) => {
      if (traceHops) traceResponse(opts.observer, response);
      paintResponse(opts.store, opts.framesSince, response);
      if (notify) opts.store.notify();
    },
  };
}
