/**
 * The `os` port of a browser host: `os/fetch` performs one `fetch` and answers its status, response headers and
 * body bytes raw. The method, the url and the egress check are the kernel's. With `stream: true` the answer comes
 * as soon as the head arrives, with an empty body and a `handle`: `os/recv` on the handle answers the next bytes
 * (`{ data, eof }`, at most `count`) and `os/close` releases it. Every other `os` operation is refused
 * `unsupported`, as a native host refuses `os/fetch`.
 */
import type { JsonValue } from '@almadar/core';
import type { OsError, OsErrorKind, OsOp, Settled } from '@almadar/core/kernel-wire';
import type { OsHostPort } from './os-port.js';
import { base64Standard } from './secret-ports.js';

type JsonObject = { [key: string]: JsonValue };

const isRecord = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (kind: OsErrorKind, message: string): Settled<JsonValue, OsError> => ({ error: { kind, message: `os/fetch: ${message}` } });

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function headersOf(value: JsonValue | undefined): Headers | string {
  const headers = new Headers();
  if (value === undefined) return headers;
  if (!Array.isArray(value)) return 'headers must be a list of { name, value }';
  for (const header of value) {
    if (!isRecord(header) || typeof header.name !== 'string' || typeof header.value !== 'string') return 'headers must be a list of { name, value }';
    headers.append(header.name, header.value);
  }
  return headers;
}

interface OpenBody {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly control: AbortController;
  held: Uint8Array;
}

const failed = (kind: OsErrorKind, op: OsOp, message: string): Settled<JsonValue, OsError> => ({ error: { kind, message: `${op}: ${message}` } });

export function createFetchOsHost(performFetch: typeof fetch): OsHostPort {
  const pending = new Set<AbortController>();
  const bodies = new Map<number, OpenBody>();
  let nextHandle = 1;

  const openOf = (op: OsOp, handle: JsonValue | undefined): OpenBody | Settled<JsonValue, OsError> => {
    const open = typeof handle === 'number' ? bodies.get(handle) : undefined;
    return open ?? failed('closed', op, 'the handle is not an open streamed response');
  };

  async function receive(args: JsonValue[]): Promise<Settled<JsonValue, OsError>> {
    const open = openOf('os/recv', args[0]);
    if (!('reader' in open)) return open;
    const count = args[1];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return failed('invalid', 'os/recv', 'the count must be a positive integer');
    try {
      if (open.held.length === 0) {
        const next = await open.reader.read();
        if (next.done) return { ok: { data: base64Standard(new Uint8Array(0)), eof: true } };
        open.held = next.value;
      }
      const data = open.held.subarray(0, count);
      open.held = open.held.subarray(count);
      return { ok: { data: base64Standard(data), eof: false } };
    } catch (raised) {
      return failed('io', 'os/recv', raised instanceof Error ? raised.message : 'the response body failed');
    }
  }

  async function release(args: JsonValue[]): Promise<Settled<JsonValue, OsError>> {
    const open = openOf('os/close', args[0]);
    if (!('reader' in open)) return open;
    if (typeof args[0] === 'number') bodies.delete(args[0]);
    pending.delete(open.control);
    open.control.abort();
    await open.reader.cancel().catch(() => undefined);
    return { ok: {} };
  }

  return {
    async answer(op: OsOp, args: JsonValue[]): Promise<Settled<JsonValue, OsError>> {
      if (op === 'os/recv') return receive(args);
      if (op === 'os/close') return release(args);
      if (op !== 'os/fetch') return { error: { kind: 'unsupported', message: `${op}: a browser host answers only os/fetch, and os/recv and os/close on the handle of a streamed one` } };
      const [method, url, request] = args;
      if (typeof method !== 'string' || typeof url !== 'string') return fail('invalid', 'the method and the url must be text');
      if (request !== undefined && !isRecord(request)) return fail('invalid', 'the request must be { headers?, body?, timeoutMs?, stream? }');
      const headers = headersOf(request?.headers);
      if (typeof headers === 'string') return fail('invalid', headers);
      const body = request?.body;
      if (body !== undefined && typeof body !== 'string') return fail('invalid', 'the body must be bytes');
      const timeoutMs = request?.timeoutMs;
      if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !(timeoutMs > 0))) return fail('invalid', 'timeoutMs must be a positive number');
      const stream = request?.stream;
      if (stream !== undefined && typeof stream !== 'boolean') return fail('invalid', 'stream must be a boolean');
      const control = new AbortController();
      pending.add(control);
      const timer = typeof timeoutMs === 'number' ? setTimeout(() => control.abort(), timeoutMs) : undefined;
      let kept = false;
      try {
        const response = await performFetch(url, { method, headers, signal: control.signal, ...(body !== undefined ? { body: bytesOf(body) } : {}) });
        const received: JsonValue[] = [];
        response.headers.forEach((value, name) => received.push({ name, value }));
        if (stream === true) {
          const handle = nextHandle;
          nextHandle += 1;
          const reader = (response.body ?? new ReadableStream<Uint8Array>({ start: (sink) => sink.close() })).getReader();
          bodies.set(handle, { reader, control, held: new Uint8Array(0) });
          kept = true;
          return { ok: { status: response.status, headers: received, body: base64Standard(new Uint8Array(0)), handle } };
        }
        return { ok: { status: response.status, headers: received, body: base64Standard(new Uint8Array(await response.arrayBuffer())) } };
      } catch (raised) {
        if (control.signal.aborted) return fail('timeout', `no answer within ${String(timeoutMs)} ms`);
        return fail('io', raised instanceof Error ? raised.message : 'the fetch failed');
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (!kept) pending.delete(control);
      }
    },
    close(): void {
      for (const control of pending) control.abort();
      pending.clear();
      for (const open of bodies.values()) void open.reader.cancel().catch(() => undefined);
      bodies.clear();
    },
  };
}
