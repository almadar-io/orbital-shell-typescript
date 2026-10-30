import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@almadar/core';
import type { OsError, OsOp, Settled } from '@almadar/core/kernel-wire';
import { InFlightCalls } from '../src/effects/in-flight-calls.js';
import { answerRequest, finishTls, type DeferredCallOutcome, type KernelHostPorts } from '../src/kernel/host.js';
import { decodeRequest } from '../src/kernel/decode.js';
import { kernelOsTls, type OsHostPort, type OsTlsPort, type OsTlsStep } from '../src/kernel/os-port.js';
import type { PersistenceAdapter } from '@almadar/core';
import type { SecretStore } from '../src/kernel/secret-ports.js';

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

  function deferringHost(osTls: OsTlsPort | undefined, parked: { deliver?: (outcome: Outcome) => void }, calls: InFlightCalls, delivered: DeferredCallOutcome[]): KernelHostPorts {
    return {
      persistence, inFlightCalls: calls,
      callService: async () => null,
      programEffect: () => undefined,
      servicePorts: (caller) => ({ caller, inputs: () => [], readableEntities: () => [], dispatchInput: async () => { throw new Error('unused'); }, read: async () => [] }),
      deliverLive: () => undefined,
      deferCallOutcome: () => (outcome) => { delivered.push(outcome); },
      os: {
        answer: () => new Promise(() => undefined),
        defer: (_op, _args, _key, deliver) => { parked.deliver = deliver; return { ok: null }; },
        cancel: () => true,
        close: () => undefined,
      },
      osCompletions: { defers: () => true, streams: () => false, event: () => ({ event: 'GOT', payload: {} }) },
      ...(osTls !== undefined ? { osTls } : {}),
    };
  }
  const waitRequest = decodeRequest({ kind: 'os', op: 'os/wait', args: [1], key: 'k1', site: { orbital: 'Main', trait: 'Host', followOn: true, emit: { success: 'GOT' } } });

  it('releases the key and delivers in the completion call itself when the kernel parks nothing (a plain socket)', async () => {
    const calls = new InFlightCalls();
    const delivered: DeferredCallOutcome[] = [];
    const parked: { deliver?: (outcome: Outcome) => void } = {};
    const host = deferringHost(tlsPort([null], []), parked, calls, delivered);
    expect(await answerRequest(host, waitRequest, { orbital: 'Main' })).toEqual({ kind: 'serviceDeferred' });
    expect(calls.inFlight('k1')).toBe(true);
    parked.deliver?.(raw);
    expect(calls.inFlight('k1')).toBe(false);
    expect(delivered).toHaveLength(1);
  });

  it('releases the key in the completion call itself when the kernel answers done without a further raw ask', async () => {
    const calls = new InFlightCalls();
    const delivered: DeferredCallOutcome[] = [];
    const parked: { deliver?: (outcome: Outcome) => void } = {};
    const host = deferringHost(tlsPort([{ done: decrypted }], []), parked, calls, delivered);
    await answerRequest(host, waitRequest, { orbital: 'Main' });
    parked.deliver?.(raw);
    expect(calls.inFlight('k1')).toBe(false);
    expect(delivered).toHaveLength(1);
  });

  it('control: holds the key until the raw ask a parked TLS operation needs is answered', async () => {
    const calls = new InFlightCalls();
    const delivered: DeferredCallOutcome[] = [];
    const parked: { deliver?: (outcome: Outcome) => void } = {};
    let answer: (outcome: Outcome) => void = () => undefined;
    const base = deferringHost(tlsPort([{ ask: { op: 'os/recv', args: [5, 1] } }, { done: decrypted }], []), parked, calls, delivered);
    const host: KernelHostPorts = { ...base, os: { ...base.os!, answer: () => new Promise((resolve) => { answer = resolve; }) } };
    await answerRequest(host, waitRequest, { orbital: 'Main' });
    parked.deliver?.(raw);
    expect(calls.inFlight('k1')).toBe(true);
    expect(delivered).toHaveLength(0);
    answer(raw);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.inFlight('k1')).toBe(false);
    expect(delivered).toHaveLength(1);
  });
});

describe('a keyed os/send with a credential segment', () => {
  function sendHost(calls: InFlightCalls, started: string[], secrets: SecretStore): KernelHostPorts {
    return {
      persistence, inFlightCalls: calls,
      callService: async () => null,
      programEffect: () => undefined,
      servicePorts: (caller) => ({ caller, inputs: () => [], readableEntities: () => [], dispatchInput: async () => { throw new Error('unused'); }, read: async () => [] }),
      deliverLive: () => undefined,
      deferCallOutcome: () => () => undefined,
      secretPorts: { random: { bytes: () => new Uint8Array(0) }, secrets },
      os: {
        answer: async () => ({ error: { kind: 'unsupported', message: 'unused' } }),
        defer: (_op, _args, key) => { started.push(key); return { ok: null }; },
        cancel: () => true,
        close: () => undefined,
      },
      osCompletions: { defers: () => true, streams: () => false, event: () => ({ event: 'GOT', payload: {} }) },
    };
  }
  const sendRequest = decodeRequest({ kind: 'os', op: 'os/send', args: [5, [{ bytes: '', credential: 'tok' }]], key: 'k1', site: { orbital: 'Main', trait: 'Host', followOn: true, emit: { success: 'GOT' } } });
  const storeOf = (get: SecretStore['get']): SecretStore => ({ get, set: async () => undefined, forget: async () => undefined });

  it('holds its key from arrival, so a cancel-call during the credential read stops the op and frees the key', async () => {
    const calls = new InFlightCalls();
    const started: string[] = [];
    let release: (value: string) => void = () => undefined;
    const host = sendHost(calls, started, storeOf(() => new Promise((resolve) => { release = resolve; })));
    const pending = answerRequest(host, sendRequest, { orbital: 'Main' });
    expect(calls.inFlight('k1')).toBe(true);
    expect(calls.cancel('k1')).toBe(true);
    release('secret');
    expect(await pending).toEqual({ kind: 'serviceCancelled' });
    expect(started).toEqual([]);
    expect(calls.inFlight('k1')).toBe(false);
  });

  it('refuses a second ask under the same key while the first is still reading its credential', async () => {
    const calls = new InFlightCalls();
    let release: (value: string) => void = () => undefined;
    const host = sendHost(calls, [], storeOf(() => new Promise((resolve) => { release = resolve; })));
    const first = answerRequest(host, sendRequest, { orbital: 'Main' });
    const second = await answerRequest(host, sendRequest, { orbital: 'Main' });
    expect(second).toEqual({ kind: 'os', result: { error: { kind: 'invalid', message: 'os/send: key k1 already has a completion pending' } } });
    release('secret');
    await first;
  });

  it('control: with no cancel the op runs once and the key stays held until its completion', async () => {
    const calls = new InFlightCalls();
    const started: string[] = [];
    const host = sendHost(calls, started, storeOf(async () => 'secret'));
    expect(await answerRequest(host, sendRequest, { orbital: 'Main' })).toEqual({ kind: 'serviceDeferred' });
    expect(started).toEqual(['k1']);
    expect(calls.inFlight('k1')).toBe(true);
  });

  it('control: a credential that is not held fails the ask and frees the key', async () => {
    const calls = new InFlightCalls();
    const started: string[] = [];
    const host = sendHost(calls, started, storeOf(async () => undefined));
    const answer = await answerRequest(host, sendRequest, { orbital: 'Main' });
    expect(answer).toEqual({ kind: 'os', result: { error: { kind: 'denied', message: 'os/send: credential tok is not held' } } });
    expect(started).toEqual([]);
    expect(calls.inFlight('k1')).toBe(false);
  });
});

describe('an os/send credential segment encode', () => {
  interface EncodeVector { encode: string; input: string; expect: string }
  const vectors: EncodeVector[] = JSON.parse(readFileSync(new URL('./fixtures/credential-encode-vectors.json', import.meta.url), 'utf8'));
  const storeOf = (value: string): SecretStore => ({ get: async () => value, set: async () => undefined, forget: async () => undefined });

  async function sent(segment: JsonValue, value: string): Promise<{ args: JsonValue[] } | { error: OsError }> {
    const asked: Array<{ op: OsOp; args: JsonValue[] }> = [];
    const host: KernelHostPorts = {
      persistence, inFlightCalls: new InFlightCalls(),
      callService: async () => null,
      programEffect: () => undefined,
      servicePorts: (caller) => ({ caller, inputs: () => [], readableEntities: () => [], dispatchInput: async () => { throw new Error('unused'); }, read: async () => [] }),
      deliverLive: () => undefined,
      deferCallOutcome: () => () => undefined,
      secretPorts: { random: { bytes: () => new Uint8Array(0) }, secrets: storeOf(value) },
      os: {
        answer: async (op, args) => { asked.push({ op, args }); return { ok: { bytes: 0 } }; },
        close: () => undefined,
      },
    };
    const answer = await answerRequest(host, decodeRequest({ kind: 'os', op: 'os/send', args: [5, [segment]] }), { orbital: 'Main' });
    if (answer.kind === 'os' && 'error' in answer.result) return { error: answer.result.error };
    return { args: asked[0]?.args ?? [] };
  }

  const decoded = (args: JsonValue[]): string => atob(String(args[1]));

  it('applies each encode to the credential value on every shared vector', async () => {
    expect(vectors.length).toBeGreaterThan(0);
    for (const v of vectors) {
      const result = await sent({ bytes: '', credential: 'CRED', encode: v.encode }, v.input);
      expect('args' in result ? new TextDecoder().decode(Uint8Array.from(decoded(result.args), (c) => c.charCodeAt(0))) : result).toBe(v.expect);
    }
  });

  it('control: a segment with no encode writes the credential verbatim', async () => {
    const result = await sent({ bytes: '', credential: 'CRED' }, 'a b&c');
    expect('args' in result ? decoded(result.args) : result).toBe('a b&c');
  });

  it('refuses an unknown or non-text encode as invalid before anything is written', async () => {
    for (const bad of ['rot13', 'BASE64', '', 7, null]) {
      const result = await sent({ bytes: '', credential: 'CRED', encode: bad }, 'x');
      expect(result).toEqual({ error: { kind: 'invalid', message: 'os/send: segment 1 encode must be one of base64, uri, form' } });
    }
  });
});

describe('an os/send segment list, as the Rust resolver reads it', () => {
  const b64 = (text: string): string => btoa(text);
  const text = (args: JsonValue[]): string => atob(String(args[1]));

  async function sentAll(segments: JsonValue[], secrets: SecretStore | undefined): Promise<{ args: JsonValue[]; reads: string[] } | { error: OsError }> {
    const asked: Array<{ args: JsonValue[] }> = [];
    const reads: string[] = [];
    const store: SecretStore | undefined = secrets === undefined ? undefined : { ...secrets, get: async (name, scope) => { reads.push(name); return secrets.get(name, scope); } };
    const host: KernelHostPorts = {
      persistence, inFlightCalls: new InFlightCalls(),
      callService: async () => null,
      programEffect: () => undefined,
      servicePorts: (caller) => ({ caller, inputs: () => [], readableEntities: () => [], dispatchInput: async () => { throw new Error('unused'); }, read: async () => [] }),
      deliverLive: () => undefined,
      deferCallOutcome: () => () => undefined,
      ...(store === undefined ? {} : { secretPorts: { random: { bytes: () => new Uint8Array(0) }, secrets: store } }),
      os: { answer: async (_op, args) => { asked.push({ args }); return { ok: { bytes: 0 } }; }, close: () => undefined },
    };
    const answer = await answerRequest(host, decodeRequest({ kind: 'os', op: 'os/send', args: [5, segments] }), { orbital: 'Main' });
    if (answer.kind === 'os' && 'error' in answer.result) return { error: answer.result.error };
    return { args: asked[0]?.args ?? [], reads };
  }
  const held = (value: string): SecretStore => ({ get: async () => value, set: async () => undefined, forget: async () => undefined });

  it('std-http-client shape: head bytes, the secret, then the request bytes', async () => {
    const result = await sentAll([{ bytes: b64('HEAD:'), credential: 'tok' }, { bytes: b64('\r\nGET /'), credential: '' }], held('S3CRET'));
    expect('args' in result ? text(result.args) : result).toBe('HEAD:S3CRET\r\nGET /');
  });

  it('control: an empty credential name resolves no secret and needs no source', async () => {
    const result = await sentAll([{ bytes: b64('plain'), credential: '' }], undefined);
    expect('args' in result ? [text(result.args), result.reads] : result).toEqual(['plain', []]);
  });

  it('refuses a segment that is not a { bytes, credential } object, or lacks either text', async () => {
    for (const [segment, message] of [
      [b64('x'), 'os/send: segment 1 is not a { bytes, credential } object'],
      [{ credential: 'tok' }, 'os/send: segment 1 needs a bytes text and a credential name'],
      [{ bytes: b64('x') }, 'os/send: segment 1 needs a bytes text and a credential name'],
      [{ bytes: 1, credential: '' }, 'os/send: segment 1 needs a bytes text and a credential name'],
      [{ bytes: '!!', credential: '' }, 'os/send: segment 1 bytes are not standard base64'],
    ] as Array<[JsonValue, string]>) {
      expect(await sentAll([segment], held('x'))).toEqual({ error: { kind: 'invalid', message } });
    }
  });

  it('a named credential with no source is denied; the encode is checked before an empty name skips it', async () => {
    expect(await sentAll([{ bytes: '', credential: 'tok' }], undefined)).toEqual({ error: { kind: 'denied', message: 'os/send: no credential source is configured' } });
    expect(await sentAll([{ bytes: '', credential: '', encode: 'rot13' }], undefined)).toEqual({ error: { kind: 'invalid', message: 'os/send: segment 1 encode must be one of base64, uri, form' } });
  });
});
