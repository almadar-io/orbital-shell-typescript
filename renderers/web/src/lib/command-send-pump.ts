/**
 * Command send pump (T7, docs/Almadar_Tick_Loop.md §3a item 2).
 *
 * Command-class events are a lossless ordered stream: two OW_DAMAGE hits must
 * land twice, and the server must apply them in the exact order the client
 * executed them. Pre-T7 the actor-queue drain `await`ed the server round trip
 * per entry, so network latency sat on the input path — a keyup's local
 * transition didn't run until every queued command ahead of it had completed
 * its round trip (R-COMMAND-DRAIN-AWAIT-INPUT-LAG: 400-900ms typical, 1.6s
 * peak under rapid platformer input).
 *
 * The pump restores ordering without the stall: jobs run strictly one at a
 * time in enqueue order (request N+1 leaves only after response N arrived, so
 * the server sees ordered commands and responses arrive in order — no seq
 * numbers, no server machinery), while the caller's continuation runs when
 * its own job settles and the drain moves on immediately. Tick-class traffic
 * never passes through here — it is lossy and goes through
 * `tick-send-relay.ts` instead.
 *
 * @packageDocumentation
 */

export interface CommandSendPump {
    /** Run `job` after every previously enqueued job settles, in FIFO order. */
    enqueue: <T>(job: () => Promise<T>) => Promise<T>;
}

export function createCommandSendPump(): CommandSendPump {
    let tail: Promise<void> = Promise.resolve();
    return {
        enqueue<T>(job: () => Promise<T>): Promise<T> {
            // A rejected job must not wedge the chain: the tail swallows the
            // rejection so later jobs still run; only this job's caller sees it.
            const result = tail.then(job);
            tail = result.then(
                () => undefined,
                () => undefined,
            );
            return result;
        },
    };
}
