import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@almadar/core';
import type { OsError, OsOp, Settled } from '@almadar/core/kernel-wire';
import { InFlightCalls } from '../src/effects/in-flight-calls.js';
import { answerRequest, finishTls, type DeferredCallOutcome, type KernelHostPorts } from '../src/kernel/host.js';
import { decodeRequest } from '../src/kernel/decode.js';
import { kernelOsTls, type OsHostPort, type OsTlsPort, type OsTlsStep } from '../src/kernel/os-port.js';
import type { PersistenceAdapter } from '@almadar/core';

type Outcome = Settled<JsonValue, OsError>;

const raw: Outcome = { ok: { data: 'AAA=', eof: false } };
const decrypted: Outcome = { ok: { data: 'cG9uZw==', eof: false } };

function hostPort(answers: Outcome[], asked: Array<{ op: OsOp; args: JsonValue[] }>): OsHostPort {
  return {
    answer: async (op, args) => {
      asked.push({ op, args });
      const next = answers.shift();
      if (next === undefined) throw new Error('the host was asked more than the test scripted');
      return next;
    },
    close: () => undefined,
  };
}

function tlsPort(steps: Array<OsTlsStep | null>, seen: Outcome[]): OsTlsPort {
  return {
    complete: (_key, outcome) => {
      seen.push(outcome);
      return steps.shift() ?? null;
    },
  };
}

const ports = (osTls: OsTlsPort | undefined): KernelHostPorts => ({
  ...(osTls !== undefined ? { osTls } : {}),
} as KernelHostPorts);

describe('a deferred raw os outcome that belongs to a kernel-owned TLS socket', () => {
  it('is handed to the kernel and the program receives the kernel\'s outcome', async () => {
    const seen: Outcome[] = [];
    const out = await finishTls(ports(tlsPort([{ done: decrypted }], seen)), hostPort([], []), 'r1', raw);
    expect(out).toEqual(decrypted);
    expect(seen).toEqual([raw]);
  });

  it('asks the host for more raw bytes while the kernel needs them, then ends with the kernel\'s outcome', async () => {
    const seen: Outcome[] = [];
    const asked: Array<{ op: OsOp; args: JsonValue[] }> = [];
    const more: Outcome = { ok: { data: 'BBB=', eof: false } };
    const steps: OsTlsStep[] = [{ ask: { op: 'os/recv', args: [5, 16384] } }, { done: decrypted }];
    const out = await finishTls(ports(tlsPort(steps, seen)), hostPort([more], asked), 'r1', raw);
    expect(out).toEqual(decrypted);
    expect(asked).toEqual([{ op: 'os/recv', args: [5, 16384] }]);
    expect(seen).toEqual([raw, more]);
  });

  it('control: a key the kernel parks nothing under keeps the host\'s outcome as it was', async () => {
    const out = await finishTls(ports(tlsPort([null], [])), hostPort([], []), 'plain', raw);
    expect(out).toEqual(raw);
  });

  it('control: a host with no TLS port keeps the host\'s outcome as it was', async () => {
    expect(await finishTls(ports(undefined), hostPort([], []), 'r1', raw)).toEqual(raw);
  });

  it('answers a failure of the follow-up raw ask as the program\'s outcome through the kernel', async () => {
    const failure: Outcome = { error: { kind: 'timeout', message: 'os/recv: timed out' } };
    const seen: Outcome[] = [];
    const steps: OsTlsStep[] = [{ ask: { op: 'os/recv', args: [5, 16384] } }, { done: failure }];
    expect(await finishTls(ports(tlsPort(steps, seen)), hostPort([failure], []), 'r1', raw)).toEqual(failure);
    expect(seen[1]).toEqual(failure);
  });

  it('is an error, not a hang, when the kernel loses the operation between raw asks', async () => {
    const out = await finishTls(ports(tlsPort([{ ask: { op: 'os/recv', args: [5, 1] } }, null], [])), hostPort([raw], []), 'r1', raw);
    expect(out).toEqual({ error: { kind: 'tls', message: 'the TLS operation vanished' } });
  });

  it('kernelOsTls reads the server handle\'s tlsComplete', () => {
    const calls: string[] = [];
    const port = kernelOsTls(() => ({ tlsComplete: (key, outcome) => { calls.push(`${key}:${outcome}`); return JSON.stringify({ done: decrypted }); } }));
    expect(port.complete('r1', raw)).toEqual({ done: decrypted });
    expect(calls).toEqual([`r1:${JSON.stringify(raw)}`]);
    expect(kernelOsTls(() => ({ tlsComplete: () => 'null' })).complete('x', raw)).toBeNull();
  });
});

const untouched = (): never => { throw new Error('the host store was not expected to be asked'); };
const persistence: PersistenceAdapter = { getById: untouched, list: untouched, create: untouched, update: untouched, delete: untouched };

describe('a keyed routed os/recv the host defers', () => {
  it('fires its route with the kernel\'s decrypted outcome, not the raw bytes', async () => {
    const delivered: DeferredCallOutcome[] = [];
    let deliverRaw: ((outcome: Outcome) => void) | undefined;
    const os: OsHostPort = {
      answer: async () => ({ error: { kind: 'unsupported', message: 'unused' } }),
      defer: (_op, _args, _key, deliver) => { deliverRaw = deliver; return { ok: null }; },
      close: () => undefined,
    };
    const host: KernelHostPorts = {
      persistence, inFlightCalls: new InFlightCalls(),
      callService: async () => null,
      programEffect: () => undefined,
      servicePorts: (caller) => ({ caller, inputs: () => [], readableEntities: () => [], dispatchInput: async () => { throw new Error('unused'); }, read: async () => [] }),
      deliverLive: () => undefined,
      deferCallOutcome: () => (outcome) => { delivered.push(outcome); },
      os,
      osCompletions: {
        defers: (op) => op === 'os/recv',
        streams: () => false,
        event: (_site, key, outcome) => ('ok' in outcome ? { event: 'GOT', payload: { ...(outcome.ok as object), key } as JsonValue } : null),
      },
      osTls: tlsPort([{ done: decrypted }], []),
    };
    const request = decodeRequest({
      kind: 'os', op: 'os/recv', args: [5, 4096], key: 'r1',
      site: { orbital: 'Main', trait: 'Host', followOn: true, emit: { success: 'GOT', failure: 'BAD' } },
    });
    expect(await answerRequest(host, request, { orbital: 'Main' })).toEqual({ kind: 'serviceDeferred' });
    deliverRaw?.(raw);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.event).toBe('GOT');
    expect(delivered[0]?.payload).toEqual({ data: 'cG9uZw==', eof: false, key: 'r1' });
  });
});
