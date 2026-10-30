/**
 * The contract of a client kernel: what a view dispatches into and what it gets back. `@almadar/ui`'s kernel client
 * (over `@almadar/kernel/client`) implements it.
 */
import type { DispatchMode, EmittedEvent, MountSeed, EventRequest, EventResponse, TransitionRejection } from '@almadar/core';
import type { CircuitStore } from './circuit-store.js';

/** One `ClientKernel.dispatch()` call's settled outcome. */
export interface ClientKernelOutcome {
  response: EventResponse;
  mode: DispatchMode;
  /**
   * True when `onLocal` already received the local arm's response (the leg
   * was posted). `serverEffects` then holds only what the server's fold
   * added — the local ones were painted before the round trip.
   */
  localPainted?: boolean;
  serverEffects?: Pick<EventResponse, 'clientEffectsByTrait'>;
  /**
   * A tick-lane dispatch: what its post's fold added on top of the local run,
   * once the post settles (undefined when a newer firing superseded it). The
   * drain never waits on it; the caller paints it when it lands.
   */
  tickSettled?: Promise<Pick<EventResponse, 'clientEffectsByTrait'> | undefined>;
}

/** Per-dispatch hooks: `onLocal` sees the locally-evaluated response before its server leg is sent. */
export interface ClientDispatchHooks {
  onLocal?: (local: EventResponse) => void;
}

/** Mount hooks: `onLocal` sees each seed's local response before the mount leg is sent. */
export interface ClientMountHooks {
  onLocal?: (trait: string, local: EventResponse) => void;
}

/** What the kernel answered to an emit that entered from outside it: the cascade it ran, with its paint and its emits. */
export interface ClientEmitOutcome {
  response: EventResponse;
}

/** One `ClientKernel.dispatchMount()` call's settled outcome. */
export interface ClientMountOutcome {
  /** Each seed's local run, in seed order (already painted through `onLocal`). */
  seeds: Array<{ trait: string; event: string; mode: DispatchMode; local: EventResponse }>;
  /** Whether any mount leg was posted. */
  posted: boolean;
  success: boolean;
  error?: string;
  /** Per-trait effect failures the posted legs reported (`effect-failed`). */
  rejections: TransitionRejection[];
  /** What the posted legs added: the server's effects and the emits the client had not run. */
  serverEffects: Pick<EventResponse, 'clientEffectsByTrait'>;
  emittedEvents: EventResponse['emittedEvents'];
}

export interface ClientKernel {
  /**
   * Enqueue one event. FIFO per kernel: this entry's local dispatch → post
   * (per the posting rule) → fold → `store.notify()` all complete before the
   * next queued entry's local dispatch begins — the twin of orbital-client's
   * `ClientKernel::dispatch` being called serially off one queue, ported to
   * JS's single-threaded-but-concurrent-microtask model where two `dispatch`
   * calls made back to back would otherwise interleave.
   *
   * A `request.tick`-stamped entry coalesces onto a pending entry with the
   * SAME `(event, targetTrait)` that is itself tick-stamped — same contract
   * as `@almadar/ui`'s `lib/event-queue-coalesce.ts` `enqueueEvent` (see
   * that file's tests, mirrored in `client-kernel.test.ts`): only the
   * pending entry's `payload` is replaced (its FIFO slot and every other
   * field are kept), a sourceless/non-tick entry is never coalesced, and an
   * entry already shifted off the queue (in flight) is never a coalesce
   * target. Every caller coalesced onto the same pending entry resolves to
   * that ONE entry's eventual outcome.
   *
   * A tick-stamped entry resolves after its LOCAL dispatch; its post goes
   * out on a per-(event, trait) newest-wins lane outside the FIFO, with no
   * rollback, so a tick round trip never delays a command.
   */
  dispatch(request: EventRequest, hooks?: ClientDispatchHooks): Promise<ClientKernelOutcome>;
  /**
   * Dispatch a server-pushed live message of THIS client's own running
   * request (`PushTarget` `origin`). Outside the FIFO, because the request
   * producing it is the entry the FIFO is waiting on; progress dispatches run
   * one at a time, in push order, and never mark traits awaiting.
   */
  dispatchProgress(request: EventRequest): Promise<ClientKernelOutcome>;
  /**
   * Show the result of a dispatch the host ran on its own (`EventTransport.subscribeHostDispatches`):
   * the host's states, rows and render land in this view. Nothing runs here and nothing is posted,
   * so the dispatch's effects happen once, on the host. Host dispatches fold one at a time, in order.
   */
  foldHostDispatch(request: EventRequest, response: EventResponse): Promise<ClientKernelOutcome>;
  /**
   * Hand the kernel an emit that happened outside it (a bus emit with no dispatch behind it, a server push). The kernel
   * decides who hears it: the emitter's own arm and every declared `listens` route (EXEC-DISP). Nothing is routed here.
   */
  deliverEmit(emitted: EmittedEvent): Promise<ClientEmitOutcome>;
  /**
   * Hand the kernel an emit another client made (a server push): it reaches its declared `listens` routes only, guards and
   * payload mapping included. The emitter's own arm does not run here, and neither the emit's `dispatched` stamp nor the
   * host's fan-out narrows who hears it.
   */
  deliverToListeners(emitted: EmittedEvent): Promise<ClientEmitOutcome>;
  /**
   * Hand the kernel the live message of this client's own running call, whose emitter already ran its own arm as that call's
   * progress dispatch: it reaches its declared `listens` routes like `deliverToListeners`, except that a route back to the
   * emitter under the emitted name is that arm again and does not run twice.
   */
  deliverOriginEmit(emitted: EmittedEvent): Promise<ClientEmitOutcome>;
  /**
   * Mount several traits in ONE FIFO entry: every seed's local arm runs and
   * paints, then one `mount` leg per owning orbital is posted and folded.
   */
  dispatchMount(
    seeds: readonly MountSeed[],
    hooks?: ClientMountHooks,
    base?: Pick<EventRequest, 'payload' | 'entityId' | 'clientId' | 'locale'>,
  ): Promise<ClientMountOutcome>;
  readonly store: CircuitStore;
}

/**
 * Show the result of a dispatch THIS kernel already ran (a tick frame's aggregate response or one of its
 * cascade dispatches): the response's states, rows and paint land in the view's store. Nothing runs and
 * nothing is posted: the in-process kernel owns the state, so (unlike `foldHostDispatch`) the server fold
 * (`applyServerResponse`) is never called. `traceHops` reports the response's executed hops to the transition
 * observer; a frame's aggregate response carries tick hops the kernel's tick observer already reported. `notify` wakes the store's subscribers after the fold; a frame folds several responses and notifies on the last only.
 */
export interface LocalFoldKernel {
  foldLocalResponse(response: EventResponse, traceHops: boolean, notify: boolean): Promise<void>;
}
