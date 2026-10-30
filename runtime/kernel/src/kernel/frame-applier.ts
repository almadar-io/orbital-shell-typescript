/**
 * Applies one host frame of the tick clock (`Kernel.frame`'s `FrameWire`) to the view. The in-process
 * kernel already ran the frame, so it folds locally (`LocalFoldKernel`), never through the server fold:
 * the aggregate response first (embed.rs: "the host folds `response` before the dispatches"; it is built
 * from the fired ticks' own outcomes, not from the dispatches, so the two are disjoint), then each tick
 * dispatch. Every post a dispatch owes (its server legs or stateful leg) and every browser-store leg goes
 * through the injected `FramePostPort`; the answers settle off the frame (`tickSettled`) so a tick round trip
 * never delays the next frame.
 */
import type { FiredTick, FrameWire, RoutedLeg } from '@almadar/core/kernel-wire';
import { isFrameWire } from '@almadar/core/kernel-wire';
import type { JsonValue, EventResponse } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import type { ClientKernelOutcome, LocalFoldKernel } from '../client/client-kernel.js';

const log = createLogger('almadar:shell-web:frame');

/** `frame()`'s JSON; `undefined` (no tick due) decodes to `undefined`. */
export function decodeFrame(json: string | undefined): FrameWire | undefined {
  if (json === undefined) return undefined;
  const value: JsonValue = JSON.parse(json);
  if (!isFrameWire(value)) throw new Error('kernel wire: frame is not a FrameWire');
  return value;
}

export type TickEffects = Pick<EventResponse, 'clientEffectsByTrait'>;

export type FrameDispatch = FrameWire['dispatches'][number];

/** The host transport's side of a frame: posts what a fired tick owes and folds the answer back through the kernel. */
export interface FramePostPort {
  /** Posts one dispatch's server legs (or stateful leg); resolves to what the server's fold added. */
  postDispatch(dispatch: FrameDispatch): Promise<TickEffects>;
  /** Sends a leg the kernel routed to the browser store; `frameResponse` is the frame's aggregate response. */
  sendBrowserLeg(leg: RoutedLeg, frameResponse: EventResponse): Promise<TickEffects>;
}

export interface FrameApplied {
  fired: FiredTick[];
  folded: number;
  browserLegs: number;
  droppedServerEffects: number;
  /** The head is the frame's aggregate response, then one outcome per browser leg, then one per dispatch. */
  outcomes: ClientKernelOutcome[];
  errors: string[];
}

const NOTHING: FrameApplied = { fired: [], folded: 0, browserLegs: 0, droppedServerEffects: 0, outcomes: [], errors: [] };

const settle = (posted: Promise<TickEffects>, failure: string, trait: string): Promise<TickEffects | undefined> =>
  posted.then<TickEffects | undefined, TickEffects | undefined>(
    (effects) => effects,
    (err: Error) => {
      log.warn(failure, { trait, error: String(err) });
      return undefined;
    },
  );

export async function applyFrame(
  json: string | undefined,
  kernel: LocalFoldKernel,
  post: FramePostPort | undefined,
): Promise<FrameApplied> {
  const frame = decodeFrame(json);
  if (frame === undefined) return NOTHING;
  for (const message of frame.errors) log.warn('frame-tick-failed', { error: message });
  const last = frame.dispatches.length - 1;
  await kernel.foldLocalResponse(frame.response, false, last < 0);
  for (const [i, dispatch] of frame.dispatches.entries()) await kernel.foldLocalResponse(dispatch.response, true, i === last);
  const outcomes: ClientKernelOutcome[] = [{ response: frame.response, mode: 'hybridClientOnly' }];
  if (post !== undefined) {
    // A tick's data in the browser store is written by the leg the kernel hands back; its answer is folded like any other.
    for (const leg of frame.browserLegs) {
      const tickSettled = settle(post.sendBrowserLeg(leg, frame.response), 'tick-browser-leg-failed', leg.leg.targetTrait ?? '');
      outcomes.push({ response: { success: true, transitioned: false, states: {}, emittedEvents: [] }, mode: 'hybridClientOnly', tickSettled });
    }
  }
  for (const dispatch of frame.dispatches) {
    if (post === undefined || (dispatch.serverLegs.length === 0 && dispatch.statefulLeg === null)) {
      outcomes.push({ response: dispatch.response, mode: dispatch.mode });
      continue;
    }
    outcomes.push({ response: dispatch.response, mode: dispatch.mode, tickSettled: settle(post.postDispatch(dispatch), 'tick-post-failed', dispatch.trait) });
  }
  return {
    fired: frame.fired,
    folded: frame.dispatches.length + 1,
    browserLegs: frame.browserLegs.length,
    droppedServerEffects: frame.droppedServerEffects,
    outcomes,
    errors: frame.errors,
  };
}
