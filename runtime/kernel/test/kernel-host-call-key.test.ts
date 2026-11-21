import { describe, expect, it } from 'vitest';
import type { EventPayload, PersistenceAdapter } from '@almadar/core';
import { InFlightCalls } from '../src/effects/in-flight-calls.js';
import { answerRequest, kernelEventRequestParser, type CallOutcomeWire, type DeferredCallOutcome, type KernelCallService, type KernelHostPorts } from '../src/kernel/host.js';
import type { OsCompletionEvent } from '../src/kernel/os-port.js';
import type { CallSiteWire } from '../src/kernel/wire.js';
import { decodeRequest } from '../src/kernel/decode.js';
import { kernelRequest } from '../src/kernel/engine.js';
import { dispatchDeclaredInput } from '../src/client/declared-input-dispatch.js';

const untouched = (): never => { throw new Error('the host store was not expected to be asked'); };
const persistence: PersistenceAdapter = { getById: untouched, list: untouched, create: untouched, update: untouched, delete: untouched };
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const request = (key: string | undefined) => decodeRequest({
  kind: 'callService', service: 'svc', method: 'work', args: {},
  ...(key !== undefined ? { key } : {}),
  site: { orbital: 'Main', trait: 'Helper', followOn: true, emit: { success: 'OK', failure: 'BAD' } },
});

type Asked = { key: string | undefined; outcome: CallOutcomeWire };

/** The kernel's `callCompletionEvent` stand-in: it records what the host handed it and answers `fired`. The payload rules (the program's key) are the kernel's and are tested there (`call_completion_tests`) and on the node host. */
function hostWith(callService: KernelCallService, fired: OsCompletionEvent | null, complete = true) {
  const delivered: DeferredCallOutcome[] = [];
  const asked: Asked[] = [];
  const host: KernelHostPorts = {
    persistence, inFlightCalls: new InFlightCalls(), callService,
    programEffect: () => undefined,
    servicePorts: (caller) => ({ caller, inputs: () => [], readableEntities: () => [], dispatchInput: async () => { throw new Error('unused'); }, read: async () => [] }),
    deliverLive: () => undefined,
    deferCallOutcome: () => (outcome) => { delivered.push(outcome); },
    ...(complete ? { callCompletion: (_site: CallSiteWire, key: string | undefined, outcome: CallOutcomeWire) => { asked.push({ key, outcome }); return fired; } } : {}),
  };
  return { host, delivered, asked };
}

const answer = (payload: EventPayload | null): KernelCallService => async () => payload;
const down: KernelCallService = async () => { throw new Error('down'); };

describe('a deferred call-service completion is the event the kernel builds', () => {
  it('a keyed success hands the kernel the answer and the ask key, and delivers the event it returns', async () => {
    const { host, delivered, asked } = hostWith(answer({ answer: 42 }), { event: 'OK', payload: { answer: 42, key: 'job' } });
    expect(await answerRequest(host, request('job'), { orbital: 'Main' })).toEqual({ kind: 'serviceDeferred' });
    await flush();
    expect(asked).toEqual([{ key: 'job', outcome: { ok: { answer: 42 } } }]);
    expect(delivered.map((d) => [d.event, d.payload, d.traitName])).toEqual([['OK', { answer: 42, key: 'job' }, 'Helper']]);
  });

  it('a failure hands the kernel the error message', async () => {
    const { host, asked } = hostWith(down, { event: 'BAD', payload: { error: 'down', key: 'job' } });
    await answerRequest(host, request('job'), { orbital: 'Main' });
    await flush();
    expect(asked).toEqual([{ key: 'job', outcome: { error: 'down' } }]);
  });

  it('edge: a keyless call hands the kernel no key', async () => {
    const { host, asked } = hostWith(answer({ answer: 42 }), { event: 'OK', payload: { answer: 42 } });
    await answerRequest(host, request(undefined), { orbital: 'Main' });
    await flush();
    expect(asked).toEqual([{ key: undefined, outcome: { ok: { answer: 42 } } }]);
  });

  it('edge: a payload that is not a record is delivered as no payload', async () => {
    const { host, delivered } = hostWith(answer(null), { event: 'OK', payload: null });
    await answerRequest(host, request('job'), { orbital: 'Main' });
    await flush();
    expect(delivered.map((d) => d.payload)).toEqual([undefined]);
  });

  it('control: an outcome the site declares no route for delivers nothing', async () => {
    const { host, delivered } = hostWith(down, null);
    await answerRequest(host, request('job'), { orbital: 'Main' });
    await flush();
    expect(delivered).toEqual([]);
  });

  it('control: a host with no kernel completion port answers the call in place', async () => {
    const { host, delivered } = hostWith(answer({ answer: 42 }), null, false);
    expect(await answerRequest(host, request('job'), { orbital: 'Main' })).toEqual({ kind: 'service', result: { ok: { answer: 42 } } });
    expect(delivered).toEqual([]);
  });
});

describe('kernelEventRequestParser', () => {
  const parser = kernelEventRequestParser({
    parseEventRequest: (payloadJson, optionsJson) => {
      const options: { event?: string } = JSON.parse(optionsJson);
      if (options.event === undefined) throw new Error('program/dispatch: not an event request: missing field `event`');
      return { event: options.event, payload: JSON.parse(payloadJson) };
    },
  });

  it('hands the kernel the payload and the option record and answers the request it parsed', () => {
    expect(parser({ n: 'x' }, { event: 'SAVE', orbital: 'Main' })).toEqual({ ok: { event: 'SAVE', payload: { n: 'x' } } });
  });

  it('control: the kernel refusing the record is the reason, never a request', () => {
    expect(parser({}, { orbital: 'Main' })).toEqual({ error: 'program/dispatch: not an event request: missing field `event`' });
  });
});

describe('no host names the viewer (EXEC-IDENTITY-1, -4)', () => {
  it('the request the kernel takes drops a user the caller named and keeps the locale', () => {
    const taken = kernelRequest({ event: 'GO', user: { uid: 'mallory' }, payload: { a: 1 } }, 'ar');
    expect(taken).toEqual({ event: 'GO', payload: { a: 1 }, locale: 'ar' });
  });

  it('control: a request that names no user passes unchanged', () => {
    expect(kernelRequest({ event: 'GO' }, undefined)).toEqual({ event: 'GO' });
  });

  it('a declared input is sent without the user its caller named', async () => {
    const sent: object[] = [];
    const contract = { findExternalInput: () => ({ orbital: 'O', trait: 'T', event: 'GO' }) };
    await dispatchDeclaredInput(contract, 'O', { targetTrait: 'T', event: 'GO', user: { uid: 'mallory' } }, async (_o, r) => { sent.push(r); return { success: true, transitioned: true, states: {}, emittedEvents: [] }; });
    expect(sent).toEqual([{ event: 'GO', payload: {}, targetTrait: 'T' }]);
  });
});
