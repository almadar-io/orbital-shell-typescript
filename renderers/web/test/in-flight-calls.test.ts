/**
 * The in-flight call registry of one running app. Two calls may run under the same key; cancelling the
 * key aborts every one of them (the compiled path's `cancelKeyedCall` does the same).
 */
import { describe, it, expect } from 'vitest';
import { InFlightCalls } from '@almadar/shell-runtime/effects/in-flight-calls';

const never = (signal: AbortSignal) => new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));

describe('InFlightCalls', () => {
  it('cancels all app-owned calls when the runtime closes or resets', async () => {
    const calls = new InFlightCalls();
    const a = calls.run('a', never);
    const b = calls.run('b', never);
    calls.cancelAll();
    expect(await Promise.all([a, b])).toEqual([{ cancelled: true }, { cancelled: true }]);
    expect(calls.inFlight('a')).toBe(false);
    expect(calls.inFlight('b')).toBe(false);
  });

  it('cancelling a key aborts every call running under it', async () => {
    const calls = new InFlightCalls();
    const first = calls.run('batch', never);
    const second = calls.run('batch', never);
    expect(calls.cancel('batch')).toBe(true);
    expect(await first).toEqual({ cancelled: true });
    expect(await second).toEqual({ cancelled: true });
    expect(calls.inFlight('batch')).toBe(false);
  });

  it('control: a call under the key that finished first leaves the other still cancellable', async () => {
    const calls = new InFlightCalls();
    expect(await calls.run('batch', async () => 'done')).toEqual({ cancelled: false, value: 'done' });
    const later = calls.run('batch', never);
    expect(calls.inFlight('batch')).toBe(true);
    calls.cancel('batch');
    expect(await later).toEqual({ cancelled: true });
  });

  it('edge: cancelling a key with nothing running is a no-op', () => {
    expect(new InFlightCalls().cancel('nothing')).toBe(false);
  });
});
