/**
 * TickScheduler — a single coalesced clock for every registered tick.
 *
 * Replaces "one independent timer per tick" with ONE requestAnimationFrame
 * accumulator loop (falling back to a single ~60fps `setInterval` where rAF
 * isn't available, e.g. Node/SSR) that walks every registered tick each pass
 * and fires whichever one(s) have crossed their own interval — so ticks due
 * in the same pass commit together instead of on independent, uncoordinated
 * timers. Each interval tick fires AT MOST ONCE per pass: missed beats are
 * dropped (the phase remainder is kept, so healthy cadence is unchanged),
 * because bursting catch-up firings after a slow pass multiplies the work
 * that made the pass slow — an unbounded accumulator is a spiral-of-death
 * amplifier that pegs the main thread and starves input. Framework-light:
 * no React, usable from `OrbitalServerRuntime` (this package) and from
 * `@almadar/ui`'s `useTraitStateMachine` alike.
 *
 * @packageDocumentation
 */
interface TickHandle {
    /** Stop just this tick; the shared loop keeps running for any others still registered. */
    stop(): void;
}
/**
 * Coalesced tick scheduler. One instance drives every tick registered on it
 * through a single shared clock.
 */
declare class TickScheduler {
    private ticks;
    private nextId;
    private running;
    private paused;
    private frameHandle;
    private readonly hasRaf;
    constructor();
    /**
     * Register a tick. `intervalMs <= 0` means "every pass" (a frame-interval
     * tick, matching LOLO's `interval: "frame"`). Returns a handle to stop
     * just this tick.
     */
    add(intervalMs: number, onDue: () => void): TickHandle;
    /**
     * Register a cron-scheduled tick (`ticks { ... every "0 9 * * *" }`).
     * Fires at most once per matching calendar minute. Throws if `expression` isn't a valid 5-field cron
     * string; callers on a path the compiler has already validated (e.g.
     * generated code) won't hit this, but a raw runtime value might.
     */
    addCron(expression: string, onDue: () => void): TickHandle;
    /** Stop every tick and the shared loop. */
    stopAll(): void;
    /** True while the scheduler is paused (no tick callback fires and no backlog accumulates). */
    get isPaused(): boolean;
    /**
     * Halt the shared loop without dropping registered ticks. No `onDue`
     * fires again until `resume()`. A no-op if already paused.
     */
    pause(): void;
    /**
     * Restart the shared loop after `pause()`. Every registered tick's phase
     * is reset (`lastTimestamp = null`) so the paused duration is never
     * counted as elapsed time — the same "first pass just captures the
     * timestamp" behavior a freshly `add()`-ed tick gets, which is what keeps
     * resume from bursting a backlog of missed beats. A no-op if not paused.
     */
    resume(): void;
    private ensureRunning;
    private maybeStop;
    /** Cancel the active rAF/interval loop, if any, and clear the running flag. */
    private stopLoop;
    private advance;
    /** Cron ticks check calendar-match at most once a second, deduped per matching minute. */
    private advanceCron;
}
/** Construct a new, independent `TickScheduler`. */
declare function createTickScheduler(): TickScheduler;

export { type TickHandle, TickScheduler, createTickScheduler };
