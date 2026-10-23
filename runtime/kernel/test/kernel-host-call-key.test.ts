import { describe, expect, it } from 'vitest';
import type { EventPayload, PersistenceAdapter } from '@almadar/core';
import { InFlightCalls } from '../src/effects/in-flight-calls.js';
import { answerRequest, type DeferredCallOutcome, type KernelCallService, type KernelHostPorts } from '../src/kernel/host.js';
import { decodeRequest } from '../src/kernel/decode.js';

const untouched = (): never => { throw new Error('the host store was not expected to be asked'); };
const persistence: PersistenceAdapter = { getById: untouched, list: untouched, create: untouched, update: untouched, delete: untouched };
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const request = (key: string | undefined) => decodeRequest({
  kind: 'callService', service: 'svc', method: 'work', args: {},
  ...(key !== undefined ? { key } : {}),
  site: { orbital: 'Main', trait: 'Helper', followOn: true, emit: { success: 'OK', failure: 'BAD' } },
});

async function deferred(key: string | undefined, callService: KernelCallService): Promise<DeferredCallOutcome> {
  const delivered: DeferredCallOutcome[] = [];
  const host: KernelHostPorts = {
    persistence, inFlightCalls: new InFlightCalls(), callService,
    programEffect: () => undefined,
    servicePorts: (caller) => ({ caller, inputs: () => [], readableEntities: () => [], dispatchInput: async () => { throw new Error('unused'); }, read: async () => [] }),
    deliverLive: () => undefined,
    deferCallOutcome: () => (outcome) => { delivered.push(outcome); },
  };
  expect(await answerRequest(host, request(key), { orbital: 'Main' })).toEqual({ kind: 'serviceDeferred' });
  await flush();
  expect(delivered).toHaveLength(1);
  return delivered[0] as DeferredCallOutcome;
}

const answer = (payload: EventPayload | null): KernelCallService => async () => payload;
const down: KernelCallService = async () => { throw new Error('down'); };

describe('deferred call-service completion echoes the ask key', () => {
  it('a keyed success carries the key beside the result fields', async () => {
    const outcome = await deferred('job', answer({ answer: 42 }));
    expect(outcome.event).toBe('OK');
    expect(outcome.payload).toEqual({ answer: 42, key: 'job' });
  });

  it('a keyed failure carries its error and the key', async () => {
    const outcome = await deferred('job', down);
    expect(outcome.event).toBe('BAD');
    expect(outcome.payload).toEqual({ error: 'down', key: 'job' });
  });

  it('control: an unkeyed success is unchanged', async () => {
    expect((await deferred(undefined, answer({ answer: 42 }))).payload).toEqual({ answer: 42 });
  });

  it('control: an unkeyed failure has no key', async () => {
    expect((await deferred(undefined, down)).payload).toEqual({ error: 'down' });
  });

  it('a keyed result that is not a record is left unchanged', async () => {
    expect((await deferred('job', answer(null))).payload).toBeUndefined();
  });
});
