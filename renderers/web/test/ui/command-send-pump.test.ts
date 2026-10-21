/**
 * Command send pump (R-COMMAND-DRAIN-AWAIT-INPUT-LAG, T7).
 *
 * Commands are a lossless ordered stream: the pump runs jobs strictly one at
 * a time in FIFO order, so the server sees commands in client-execution order
 * and responses land in order — without the actor-queue drain awaiting the
 * network on the input path.
 */

import { describe, it, expect } from 'vitest';
import { createCommandSendPump } from '../../src/lib/command-send-pump';

function deferred(): { promise: Promise<string>; resolve: (v: string) => void; reject: (e: Error) => void } {
    let resolve: (v: string) => void = () => undefined;
    let reject: (e: Error) => void = () => undefined;
    const promise = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('createCommandSendPump', () => {
    it('runs jobs in FIFO order', async () => {
        const pump = createCommandSendPump();
        const ran: number[] = [];
        const jobs = [0, 1, 2, 3].map((i) =>
            pump.enqueue(async () => {
                ran.push(i);
                return i;
            }),
        );
        await Promise.all(jobs);
        expect(ran).toEqual([0, 1, 2, 3]);
    });

    it('serializes: job N+1 never starts before job N settles', async () => {
        const pump = createCommandSendPump();
        const gate = deferred();
        const events: string[] = [];
        const a = pump.enqueue(async () => {
            events.push('a:start');
            await gate.promise;
            events.push('a:end');
            return 'a';
        });
        const b = pump.enqueue(async () => {
            events.push('b:start');
            return 'b';
        });
        await Promise.resolve();
        expect(events).toEqual(['a:start']); // b holds while a is in flight
        gate.resolve('ok');
        await Promise.all([a, b]);
        expect(events).toEqual(['a:start', 'a:end', 'b:start']);
    });

    it('a rejected job rejects only its own enqueue promise — the chain runs on', async () => {
        const pump = createCommandSendPump();
        const ran: string[] = [];
        const first = pump.enqueue(async () => {
            ran.push('first');
            throw new Error('network down');
        });
        const second = pump.enqueue(async () => {
            ran.push('second');
            return 'ok';
        });
        await expect(first).rejects.toThrow('network down');
        await expect(second).resolves.toBe('ok');
        expect(ran).toEqual(['first', 'second']);
        // and the pump still accepts work afterwards
        await expect(pump.enqueue(async () => 'third')).resolves.toBe('third');
    });

    it('jobs enqueued during a flight queue up and run in order (the burst case)', async () => {
        const pump = createCommandSendPump();
        const gate = deferred();
        const ran: string[] = [];
        void pump.enqueue(async () => {
            ran.push('hold');
            return gate.promise;
        });
        // burst arrives while the first job holds
        const burst = ['b1', 'b2', 'b3'].map((id) =>
            pump.enqueue(async () => {
                ran.push(id);
                return id;
            }),
        );
        gate.resolve('done');
        const results = await Promise.all(burst);
        expect(ran).toEqual(['hold', 'b1', 'b2', 'b3']);
        expect(results).toEqual(['b1', 'b2', 'b3']);
    });
});
