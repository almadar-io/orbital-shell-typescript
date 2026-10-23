import { FiredTick, FrameWire, RoutedLeg } from '@almadar/core/kernel-wire';
import { OrbitalEventResponse, JsonValue } from '@almadar/core';
import { ClientKernelOutcome, LocalFoldKernel } from '../client/client-kernel.js';
import '../client/circuit-store.js';
import '../client/awaiting.js';
import '../client/state-book.js';
import '../client/trait-types.js';

/**
 * Applies one host frame of the tick clock (`Kernel.frame`'s `FrameWire`) to the view. The in-process
 * kernel already ran the frame, so it folds locally (`LocalFoldKernel`), never through the server fold:
 * the aggregate response first (embed.rs: "the host folds `response` before the dispatches"; it is built
 * from the fired ticks' own outcomes, not from the dispatches, so the two are disjoint), then each tick
 * dispatch. Every post a dispatch owes (its server legs or stateful leg) and every browser-store leg goes
 * through the injected `FramePostPort`; the answers settle off the frame (`tickSettled`) so a tick round trip
 * never delays the next frame.
 */

declare function isFrameWire(value: JsonValue): value is JsonValue & FrameWire;
/** `frame()`'s JSON; `undefined` (no tick due) decodes to `undefined`. */
declare function decodeFrame(json: string | undefined): FrameWire | undefined;
type TickEffects = Pick<OrbitalEventResponse, 'clientEffects' | 'clientEffectsByTrait'>;
type FrameDispatch = FrameWire['dispatches'][number];
/** The host transport's side of a frame: posts what a fired tick owes and folds the answer back through the kernel. */
interface FramePostPort {
    /** Posts one dispatch's server legs (or stateful leg); resolves to what the server's fold added. */
    postDispatch(dispatch: FrameDispatch): Promise<TickEffects>;
    /** Sends a leg the kernel routed to the browser store; `frameResponse` is the frame's aggregate response. */
    sendBrowserLeg(leg: RoutedLeg, frameResponse: OrbitalEventResponse): Promise<TickEffects>;
}
interface FrameApplied {
    fired: FiredTick[];
    folded: number;
    browserLegs: number;
    droppedServerEffects: number;
    /** The head is the frame's aggregate response, then one outcome per browser leg, then one per dispatch. */
    outcomes: ClientKernelOutcome[];
    errors: string[];
}
declare function applyFrame(json: string | undefined, kernel: LocalFoldKernel, post: FramePostPort | undefined): Promise<FrameApplied>;

export { type FrameApplied, type FrameDispatch, type FramePostPort, type TickEffects, applyFrame, decodeFrame, isFrameWire };
