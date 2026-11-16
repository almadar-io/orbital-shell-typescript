/**
 * G-RUNTIME-041: the hosted stateless route resolves which catalog behavior an
 * event belongs to from `request.behavior`. Orbital names are not unique
 * across the catalog (project-friday's `GlobalSearchOrbital` vs
 * std-global-search's own), so without it the route guessed — and ran
 * project-friday's search against the wrong bundle. The transport knows the
 * registered schema and stamps its name on every send.
 */
import { describe, it, expect } from 'vitest';
import type { OrbitalSchema } from '@almadar/core';
import { createHttpTransport, SessionEndedError, TransportStatusError } from '@almadar/shell-runtime/client/EventTransport';
import { blobs, FRAMED_MEDIA_TYPE, handedJson, isBlobMarker } from '@almadar/shell-runtime/kernel/blobs';

describe('createHttpTransport — behavior addressing', () => {
  it('stamps the registered schema name on every posted event', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/register')) return new Response(JSON.stringify({ success: true, topology: 'stateless' }));
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ success: true, transitioned: true, states: {}, emittedEvents: [] }));
    }) as typeof fetch;
    const transport = createHttpTransport({ serverUrl: 'http://x/api/orbitals', fetch: fetchStub });
    await transport.register({ name: 'project-friday', orbitals: [] } as OrbitalSchema);
    await transport.send('GlobalSearchOrbital', { event: 'SEARCH', targetTrait: 'GlobalSearchAll' });
    expect(bodies[0]?.['behavior']).toBe('project-friday');
  });
});

describe('createHttpTransport — an ended session', () => {
  const transportAnswering = (status: number, body: Record<string, unknown>) => {
    const fetchStub = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/register')) return new Response(JSON.stringify({ success: true, topology: 'stateful' }));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return createHttpTransport({ serverUrl: 'http://x/api/orbitals', fetch: fetchStub });
  };

  it('throws SessionEndedError when the host answers SESSION_ENDED, so the client re-mounts with its frames', async () => {
    const transport = transportAnswering(409, { error: 'the session ended', code: 'SESSION_ENDED' });
    await expect(transport.send('Main', { event: 'READ_BACK', targetTrait: 'Viewer' })).rejects.toBeInstanceOf(SessionEndedError);
  });

  it('control: any other refusal is a typed TransportStatusError carrying its status and code', async () => {
    const transport = transportAnswering(404, { error: 'Orbital not found', code: 'ORBITAL_NOT_FOUND' });
    const failure = await transport.send('Main', { event: 'READ_BACK', targetTrait: 'Viewer' }).catch((err: Error) => err);
    expect(failure).toBeInstanceOf(TransportStatusError);
    expect(failure).toMatchObject({ status: 404, refusal: { code: 'ORBITAL_NOT_FOUND', error: 'Orbital not found' } });
  });
});

describe('createHttpTransport — framed answers (EXEC-DIST-16b)', () => {
  const program = '{"name":"guest","orbitals":[]}';
  const framedBody = (): Uint8Array<ArrayBuffer> => {
    const head = new TextEncoder().encode(JSON.stringify({ success: true, transitioned: true, states: {}, emittedEvents: [{ event: 'GUEST_CLIENT', payload: { guest: 'g', program: { $blob: 0 } } }] }));
    const blob = new TextEncoder().encode(program);
    const body = new Uint8Array(8 + head.length + blob.length);
    const view = new DataView(body.buffer);
    view.setUint32(0, head.length, true);
    body.set(head, 4);
    view.setUint32(4 + head.length, blob.length, true);
    body.set(blob, 8 + head.length);
    return body;
  };
  const transportAnswering = (answer: () => Response, accepted: string[]) => {
    const fetchStub: typeof fetch = async (url, init) => {
      if (String(url).endsWith('/register')) return new Response(JSON.stringify({ success: true, topology: 'stateful' }));
      accepted.push(new Headers(init?.headers).get('accept') ?? '');
      return answer();
    };
    return createHttpTransport({ serverUrl: 'http://x/api/orbitals', fetch: fetchStub });
  };

  it('asks for the framed body and keeps its blobs in the page table, naming them in the answer', async () => {
    const accepted: string[] = [];
    const transport = transportAnswering(() => new Response(framedBody(), { headers: { 'content-type': FRAMED_MEDIA_TYPE } }), accepted);
    const answer = await transport.send('Main', { event: 'LOAD', targetTrait: 'GuestSession' });
    expect(accepted[0]).toContain(FRAMED_MEDIA_TYPE);
    const marker = answer.emittedEvents[0]?.payload?.['program'];
    if (!isBlobMarker(marker)) throw new Error(`the program is a blob marker: ${JSON.stringify(marker)}`);
    expect(new TextDecoder().decode(blobs.bytes(marker.$blob))).toBe(program);
    expect(handedJson(answer)).toBe(JSON.stringify([marker.$blob]));
    blobs.release(JSON.stringify([marker.$blob]));
  });

  it('control: a JSON answer is read as it was and hands no blob', async () => {
    const plain = { success: true, transitioned: true, states: {}, emittedEvents: [{ event: 'NOTE', payload: { text: 'hi' } }] };
    const transport = transportAnswering(() => new Response(JSON.stringify(plain), { headers: { 'content-type': 'application/json' } }), []);
    const answer = await transport.send('Main', { event: 'LOAD', targetTrait: 'GuestSession' });
    expect(answer).toEqual(plain);
    expect(handedJson(answer)).toBeUndefined();
  });
});
