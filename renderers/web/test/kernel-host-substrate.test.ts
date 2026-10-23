import { expect, it } from 'vitest';
import type { JsonValue } from '@almadar/core';
import { untouchedPersistence } from './helpers/persistence.js';
import { InFlightCalls } from '@almadar/shell-runtime/effects/in-flight-calls';
import { answerRequest, type DeferredCallOutcome, type KernelHostPorts } from '@almadar/shell-runtime/kernel/host';
import type { OsError, Settled } from '@almadar/core/kernel-wire';
import { decodeRequest } from '@almadar/shell-runtime/kernel/decode';

const request = () => decodeRequest({ kind: 'substrate', op: 'program/read', args: [], key: 'job', site: { orbital: 'Main', trait: 'Worker', entityId: 'r1', followOn: true, emit: { success: 'DONE', failure: 'FAILED' } } });
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

it('defers keyed substrate answers, preserves context and suppresses cancelled completion', async () => {
  const delivered: DeferredCallOutcome[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const calls = new InFlightCalls();
  const host: KernelHostPorts = {
    persistence: untouchedPersistence(), inFlightCalls: calls,
    callService: async () => null,
    programEffect: () => async () => { await gate; return { ok: true, result: 'value' }; },
    servicePorts: (caller, _user, message) => ({ caller, message, inputs: () => [], readableEntities: () => [], dispatchInput: async () => { throw new Error('unused'); }, read: async () => [] }),
    deliverLive: () => undefined,
    deferCallOutcome: () => (outcome) => { delivered.push(outcome); },
    substrateCompletion: (site, key, op, args, outcome) => {
      expect(site.trait).toBe('Worker');
      expect(op).toBe('program/read');
      expect(args).toEqual(request().args);
      expect(outcome).toEqual({ ok: 'value' });
      return { event: 'CANONICAL', payload: { key, result: 1 } };
    },
  };
  expect(await answerRequest(host, request(), { orbital: 'Main', user: { id: 'u1' }, originClientId: 'tab' })).toEqual({ kind: 'serviceDeferred' });
  expect(delivered).toEqual([]);
  expect(await answerRequest(host, request(), { orbital: 'Main' })).toMatchObject({ kind: 'substrate', result: { error: { message: 'key job already has a completion pending' } } });
  release();
  await flush();
  expect(delivered).toEqual([{ orbital: 'Main', traitName: 'Worker', event: 'CANONICAL', payload: { key: 'job', result: 1 }, entityId: 'r1', originClientId: 'tab', user: { id: 'u1' }, locale: undefined }]);
  expect(calls.inFlight('job')).toBe(false);
  delivered.length = 0;
  expect(await answerRequest(host, request(), { orbital: 'Main' })).toEqual({ kind: 'serviceDeferred' });
  await answerRequest(host, { kind: 'cancelCall', key: 'job' }, { orbital: 'Main' });
  await flush();
  expect(delivered).toEqual([]);
  const unkeyed = decodeRequest({ kind: 'substrate', op: 'program/read', args: [] });
  expect(await answerRequest(host, unkeyed, { orbital: 'Main' })).toEqual({ kind: 'substrate', result: { ok: 'value' } });
  let emit: (value: JsonValue) => void = () => undefined;
  let unsubscribed = 0;
  const streaming: KernelHostPorts = {
    ...host,
    substrateStream: () => ({ subscribe: (message) => { emit = message; return () => { unsubscribed += 1; }; } }),
    substrateMessage: (_site, key, value) => ({ event: 'MESSAGE', payload: { key, chunk: value } }),
  };
  const live = decodeRequest({ kind: 'substrate', op: 'program/live', args: [], key: 'feed', site: { orbital: 'Main', trait: 'Worker', followOn: true, emit: { onMessage: 'MESSAGE' } } });
  expect(await answerRequest(streaming, live, { orbital: 'Main' })).toEqual({ kind: 'serviceDeferred' });
  emit({ text: 'one' });
  expect(delivered.map((call) => call.payload)).toEqual([{ key: 'feed', chunk: { text: 'one' } }]);
  await answerRequest(streaming, { kind: 'cancelCall', key: 'feed' }, { orbital: 'Main' });
  emit({ text: 'late' });
  await flush();
  expect(delivered).toHaveLength(1);
  expect(unsubscribed).toBe(1);
  expect(calls.inFlight('feed')).toBe(false);
  let completeOs: (outcome: Settled<JsonValue, OsError>) => void = () => undefined;
  let cancelledOs = 0;
  let releaseCross: () => void = () => undefined;
  const crossGate = new Promise<void>((resolve) => { releaseCross = resolve; });
  const shared: KernelHostPorts = {
    ...host,
    programEffect: () => async () => { await crossGate; return { ok: true, result: 'value' }; },
    os: { answer: async () => ({ ok: null }), defer: (_op, _args, _key, deliver) => { completeOs = deliver; return { ok: null }; }, cancel: () => { cancelledOs += 1; return true; }, close: () => undefined },
    osCompletions: { defers: () => true, streams: () => false, event: () => ({ event: 'OS_DONE', payload: {} }) },
  };
  const os = decodeRequest({ kind: 'os', op: 'os/wait', args: [1], key: 'shared', site: { trait: 'Worker', followOn: true, emit: { success: 'OS_DONE' } } });
  const sameKey = decodeRequest({ kind: 'substrate', op: 'program/read', args: [], key: 'shared', site: { trait: 'Worker', followOn: true, emit: { success: 'DONE' } } });
  expect(await answerRequest(shared, os, { orbital: 'Main' })).toEqual({ kind: 'serviceDeferred' });
  expect(await answerRequest(shared, sameKey, { orbital: 'Main' })).toMatchObject({ kind: 'substrate', result: { error: { message: 'key shared already has a completion pending' } } });
  await answerRequest(shared, { kind: 'cancelCall', key: 'shared' }, { orbital: 'Main' });
  const beforeLateOs = delivered.length;
  completeOs({ ok: 0 });
  expect(delivered).toHaveLength(beforeLateOs);
  expect(cancelledOs).toBeGreaterThan(0);
  expect(await answerRequest(shared, sameKey, { orbital: 'Main' })).toEqual({ kind: 'serviceDeferred' });
  expect(await answerRequest(shared, os, { orbital: 'Main' })).toMatchObject({ kind: 'os', result: { error: { kind: 'invalid', message: 'os/wait: key shared already has a completion pending' } } });
  await answerRequest(shared, { kind: 'cancelCall', key: 'shared' }, { orbital: 'Main' });
  releaseCross();
  await flush();
  expect(calls.inFlight('shared')).toBe(false);
  expect(await answerRequest(shared, os, { orbital: 'Main' })).toEqual({ kind: 'serviceDeferred' });
  completeOs({ ok: 0 });
  expect(calls.inFlight('shared')).toBe(false);
  const refused: KernelHostPorts = {
    ...host,
    servicePorts: (caller, _user, message) => ({ caller, message, inputs: () => [], readableEntities: () => [], read: async () => [], dispatchInput: async () => { throw new Error('unused'); }, dispatchRequest: async () => ({ ok: false, error: 'missing', code: 'ORBITAL_NOT_FOUND', status: 404 }) }),
  };
  expect(await answerRequest(refused, decodeRequest({ kind: 'substrate', op: 'program/dispatch', args: ['Main.Worker.GO', {}, { orbital: 'Main', targetTrait: 'Worker', event: 'GO', wire: true }] }), { orbital: 'Main' })).toEqual({ kind: 'substrate', result: { error: { message: 'missing', errors: [{ code: 'ORBITAL_NOT_FOUND', message: 'missing', status: 404 }] } } });
});
