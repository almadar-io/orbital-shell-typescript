/**
 * The in-flight `call-service` registry of ONE running app: a call declared
 * with a `key` registers here for as long as it runs, and `cancel-call` aborts
 * every call running under that key. One instance is shared by every transition of the app.
 */
type KeyedCallOutcome<T> = {
    cancelled: true;
} | {
    cancelled: false;
    value: T;
};
interface KeyedCallLease {
    signal: AbortSignal;
    release(): void;
}
declare class InFlightCalls {
    private readonly calls;
    /** Whether a call started with `key` is still running. */
    inFlight(key: string): boolean;
    /**
     * Run `work` registered under `key`, handing it the abort signal; `work` must settle promptly once the
     * signal aborts (see `untilAborted`). The call is cancelled when the signal was aborted by the time
     * `work` settles, whatever it settled with.
     */
    run<T>(key: string, work: (signal: AbortSignal) => Promise<T>): Promise<KeyedCallOutcome<T>>;
    reserve(key: string): KeyedCallLease | undefined;
    private track;
    cancelAll(): void;
    /** Abort every call running under `key`; false (a no-op) when none is. */
    cancel(key: string): boolean;
}
/** `promise`, or a rejection as soon as `signal` aborts: a provider that ignores the signal is not waited for. */
declare function untilAborted<T>(signal: AbortSignal, promise: Promise<T>): Promise<T>;

export { InFlightCalls, type KeyedCallLease, type KeyedCallOutcome, untilAborted };
