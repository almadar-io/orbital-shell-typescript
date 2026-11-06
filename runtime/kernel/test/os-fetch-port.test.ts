import { describe, expect, it } from 'vitest';
import { createFetchOsHost } from '../src/kernel/os-fetch-port.js';
import { answerRequest, type KernelHostPorts } from '../src/kernel/host.js';
import type { IoRequestWire, OsError, OsOp, Settled } from '@almadar/core/kernel-wire';
import type { GpuAnswerPort } from '../src/kernel/os-port.js';
import type { JsonValue } from '@almadar/core';

const reply = (status: number, headers: Record<string, string>, body: string): Response => new Response(body, { status, headers });

describe('the browser os port (os/fetch)', () => {
  it('performs the fetch the kernel asked for and answers the status, headers and body bytes raw', async () => {
    const seen: Array<{ url: string; method: string | undefined; accept: string | null; body: string }> = [];
    const host = createFetchOsHost(async (input, init) => {
      seen.push({ url: String(input), method: init?.method, accept: new Headers(init?.headers).get('accept'), body: init?.body === undefined ? '' : new TextDecoder().decode(init.body as Uint8Array) });
      return reply(404, { 'content-type': 'text/plain' }, 'nope');
    });
    const answered = await host.answer('os/fetch', ['POST', 'https://a.example.test/items', { headers: [{ name: 'accept', value: 'application/json' }], body: btoa('payload') }]);
    expect(seen).toEqual([{ url: 'https://a.example.test/items', method: 'POST', accept: 'application/json', body: 'payload' }]);
    expect(answered).toEqual({ ok: { status: 404, headers: [{ name: 'content-type', value: 'text/plain' }], body: btoa('nope') } });
  });

  it('refuses every other os operation as unsupported without fetching, and a malformed request as invalid', async () => {
    const host = createFetchOsHost(async () => { throw new Error('must not fetch'); });
    expect(await host.answer('os/tcp-connect', ['db.internal', 5432])).toMatchObject({ error: { kind: 'unsupported' } });
    expect(await host.answer('os/fetch', ['GET', 7])).toMatchObject({ error: { kind: 'invalid' } });
    expect(await host.answer('os/fetch', ['GET', 'https://a.example.test/', { headers: 'accept' }])).toMatchObject({ error: { kind: 'invalid' } });
    expect(await host.answer('os/fetch', ['GET', 'https://a.example.test/', { timeoutMs: 0 }])).toMatchObject({ error: { kind: 'invalid' } });
  });

  it('answers a network failure as io and a call past timeoutMs as timeout', async () => {
    const down = createFetchOsHost(async () => { throw new TypeError('Failed to fetch'); });
    expect(await down.answer('os/fetch', ['GET', 'https://a.example.test/'])).toEqual({ error: { kind: 'io', message: 'os/fetch: Failed to fetch' } });
    const slow = createFetchOsHost((_input, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    expect(await slow.answer('os/fetch', ['GET', 'https://a.example.test/', { timeoutMs: 5 }])).toMatchObject({ error: { kind: 'timeout' } });
  });

  const chunked = (parts: string[]): Response => {
    const encoder = new TextEncoder();
    let at = 0;
    return new Response(new ReadableStream<Uint8Array>({
      pull(sink) {
        if (at < parts.length) sink.enqueue(encoder.encode(parts[at++]));
        else sink.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };

  it('answers a streamed fetch at the head with a handle, then each os/recv with the next bytes up to count and eof at the end', async () => {
    const host = createFetchOsHost(async () => chunked(['data: a\n\n', 'data: b\n\n']));
    const head = await host.answer('os/fetch', ['GET', 'https://a.example.test/events', { stream: true }]);
    expect(head).toEqual({ ok: { status: 200, headers: [{ name: 'content-type', value: 'text/event-stream' }], body: '', handle: 1 } });
    expect(await host.answer('os/recv', [1, 4])).toEqual({ ok: { data: btoa('data'), eof: false } });
    expect(await host.answer('os/recv', [1, 100])).toEqual({ ok: { data: btoa(': a\n\n'), eof: false } });
    expect(await host.answer('os/recv', [1, 100])).toEqual({ ok: { data: btoa('data: b\n\n'), eof: false } });
    expect(await host.answer('os/recv', [1, 100])).toEqual({ ok: { data: '', eof: true } });
    expect(await host.answer('os/close', [1])).toEqual({ ok: {} });
  });

  it('control: a fetch without stream answers the whole body at once and opens no handle', async () => {
    const host = createFetchOsHost(async () => chunked(['a', 'b']));
    expect(await host.answer('os/fetch', ['GET', 'https://a.example.test/events'])).toEqual({ ok: { status: 200, headers: [{ name: 'content-type', value: 'text/event-stream' }], body: btoa('ab') } });
    expect(await host.answer('os/recv', [1, 4])).toMatchObject({ error: { kind: 'closed' } });
  });

  it('refuses os/recv and os/close on a handle that is not open or was closed, a bad count, and a stream that is not a boolean', async () => {
    const host = createFetchOsHost(async () => chunked(['abc']));
    expect(await host.answer('os/recv', [9, 4])).toMatchObject({ error: { kind: 'closed' } });
    expect(await host.answer('os/close', [9])).toMatchObject({ error: { kind: 'closed' } });
    await host.answer('os/fetch', ['GET', 'https://a.example.test/events', { stream: true }]);
    expect(await host.answer('os/recv', [1, 0])).toMatchObject({ error: { kind: 'invalid' } });
    expect(await host.answer('os/close', [1])).toEqual({ ok: {} });
    expect(await host.answer('os/recv', [1, 4])).toMatchObject({ error: { kind: 'closed' } });
    expect(await host.answer('os/fetch', ['GET', 'https://a.example.test/events', { stream: 'yes' }])).toMatchObject({ error: { kind: 'invalid' } });
  });

  it('bounds the wait for a streamed head by timeoutMs and aborts every open response on close', async () => {
    const slow = createFetchOsHost((_input, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    expect(await slow.answer('os/fetch', ['GET', 'https://a.example.test/', { stream: true, timeoutMs: 5 }])).toMatchObject({ error: { kind: 'timeout' } });
    let signal: AbortSignal | null | undefined;
    const open = createFetchOsHost(async (_input, init) => { signal = init?.signal; return chunked(['abc']); });
    await open.answer('os/fetch', ['GET', 'https://a.example.test/', { stream: true }]);
    open.close();
    expect(signal?.aborted).toBe(true);
    expect(await open.answer('os/recv', [1, 4])).toMatchObject({ error: { kind: 'closed' } });
  });
});

describe('a browser program\'s os ask through the host loop', () => {
  const osAsk = (op: OsOp, args: JsonValue[]): IoRequestWire => ({ kind: 'os', op, args });
  const withOs = (os: ReturnType<typeof createFetchOsHost> | undefined): KernelHostPorts => ({ deferCallOutcome: () => () => undefined, ...(os !== undefined ? { os } : {}) } as KernelHostPorts);

  it('reaches the fetch port: the head with a handle, then the bytes by os/recv, then os/close', async () => {
    const fetched: string[] = [];
    const os = createFetchOsHost(async (input) => { fetched.push(String(input)); return new Response('hello', { status: 200 }); });
    const scope = { orbital: 'Main' };
    const head = await answerRequest(withOs(os), osAsk('os/fetch', ['GET', 'https://a.example.test/x', { stream: true }]), scope);
    expect(fetched).toEqual(['https://a.example.test/x']);
    expect(head).toEqual({ kind: 'os', result: { ok: { status: 200, headers: [{ name: 'content-type', value: 'text/plain;charset=UTF-8' }], body: '', handle: 1 } } });
    expect(await answerRequest(withOs(os), osAsk('os/recv', [1, 16]), scope)).toEqual({ kind: 'os', result: { ok: { data: btoa('hello'), eof: false } } });
    expect(await answerRequest(withOs(os), osAsk('os/recv', [1, 16]), scope)).toEqual({ kind: 'os', result: { ok: { data: '', eof: true } } });
    expect(await answerRequest(withOs(os), osAsk('os/close', [1]), scope)).toEqual({ kind: 'os', result: { ok: {} } });
  });

  it('control: a host constructed with no os port denies the same ask without fetching', async () => {
    expect(await answerRequest(withOs(undefined), osAsk('os/fetch', ['GET', 'https://a.example.test/x']), { orbital: 'Main' })).toMatchObject({ kind: 'os', result: { error: { kind: 'denied' } } });
  });
});

describe('the browser os port (gpu/*)', () => {
  const never = async (): Promise<Response> => { throw new Error('must not fetch'); };
  const fake = (): { port: GpuAnswerPort; asked: Array<{ op: OsOp; args: JsonValue[] }>; closed: number[]; release: Array<() => void> } => {
    const asked: Array<{ op: OsOp; args: JsonValue[] }> = [];
    const closed: number[] = [];
    const release: Array<() => void> = [];
    const port: GpuAnswerPort = {
      answer: (op, args) => {
        asked.push({ op, args });
        const id = asked.length;
        return new Promise((resolve) => { release.push(() => resolve({ ok: { device: id } })); });
      },
      closeAll: () => { closed.push(1); },
    };
    return { port, asked, closed, release };
  };

  it('answers a sync gpu ask through the port with its op and args', async () => {
    const { port, asked, release } = fake();
    const host = createFetchOsHost(never, { gpu: port });
    const pending = host.answer('gpu/buffer-create', [1, { size: 4, usage: ['storage'] }]);
    release[0]?.();
    expect(await pending).toEqual({ ok: { device: 1 } });
    expect(asked).toEqual([{ op: 'gpu/buffer-create', args: [1, { size: 4, usage: ['storage'] }] }]);
  });

  it('defers a gpu ask: the port answer reaches deliver once, a cancelled key delivers nothing', async () => {
    const { port, asked, release } = fake();
    const host = createFetchOsHost(never, { gpu: port });
    const delivered: Array<string> = [];
    expect(host.defer?.('gpu/device-open', [{}], 'a', (outcome) => delivered.push(JSON.stringify(outcome)))).toEqual({ ok: null });
    expect(host.defer?.('gpu/submit', [1, []], 'a', () => undefined)).toMatchObject({ error: { kind: 'invalid' } });
    expect(host.defer?.('gpu/read', [2, 0, 4], 'b', (outcome) => delivered.push(JSON.stringify(outcome)))).toEqual({ ok: null });
    expect(host.cancel?.('b')).toBe(true);
    release.forEach((run) => run());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(delivered).toEqual([JSON.stringify({ ok: { device: 1 } })]);
    expect(asked.map((ask) => ask.op)).toEqual(['gpu/device-open', 'gpu/read']);
  });

  it('delivers a port rejection as an io error', async () => {
    const port: GpuAnswerPort = { answer: () => Promise.reject(new Error('lost')), closeAll: () => undefined };
    const host = createFetchOsHost(never, { gpu: port });
    const delivered: Array<Settled<JsonValue, OsError>> = [];
    host.defer?.('gpu/read', [2, 0, 4], 'k', (outcome) => delivered.push(outcome));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(delivered).toEqual([{ error: { kind: 'io', message: 'gpu/read: lost' } }]);
  });

  it('close calls closeAll', () => {
    const { port, closed } = fake();
    createFetchOsHost(never, { gpu: port }).close();
    expect(closed).toEqual([1]);
  });

  it('control: without a gpu port every gpu ask answers unsupported with the host text, sync or deferred, and os/fetch is unaffected', async () => {
    const host = createFetchOsHost(async () => reply(200, {}, 'ok'));
    expect(await host.answer('gpu/buffer-create', [1, {}])).toEqual({ error: { kind: 'unsupported', message: 'gpu/buffer-create: this host has no gpu' } });
    expect(host.defer?.('gpu/submit', [1, []], 'k', () => undefined)).toEqual({ error: { kind: 'unsupported', message: 'gpu/submit: this host has no gpu' } });
    expect(await host.answer('os/fetch', ['GET', 'https://a.example.test/'])).toMatchObject({ ok: { status: 200 } });
  });

  it('control: a non-gpu deferring ask is refused unsupported and a gpu port is never asked', () => {
    const { port, asked } = fake();
    const host = createFetchOsHost(never, { gpu: port });
    expect(host.defer?.('os/wait', [1], 'k', () => undefined)).toMatchObject({ error: { kind: 'unsupported' } });
    expect(asked).toEqual([]);
  });
});
