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
import { createHttpTransport, SessionEndedError } from '@almadar/shell-runtime/client/EventTransport';

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

  it('control: any other refusal answers as it does today', async () => {
    const transport = transportAnswering(404, { error: 'Orbital not found', code: 'ORBITAL_NOT_FOUND' });
    const answered = await transport.send('Main', { event: 'READ_BACK', targetTrait: 'Viewer' });
    expect((answered as unknown as { code: string }).code).toBe('ORBITAL_NOT_FOUND');
  });
});
