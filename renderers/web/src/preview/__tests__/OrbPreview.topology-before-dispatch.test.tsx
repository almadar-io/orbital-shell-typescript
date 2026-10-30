// @vitest-environment jsdom
/**
 * std-realtime-chat "sending does nothing", stateless topology: the page's
 * mount INITs were posted while the bridge's `register()` (which reports the
 * topology) was still pending, so they went out in the stateful shape (no
 * carried circuit state) to a stateless server, whose fresh-frame default
 * rows then overwrote the conversation the rail had just opened. No dispatch
 * may be posted before the transport's topology is known.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EventRequest, OrbitalSchema } from '@almadar/core';
import type { EventTransport } from '../../index';
import { OrbPreview } from '../OrbPreview';
import { statelessKernelTransport } from '../../test-support/stateless-kernel';
import { TEST_TYPE_CONTRACT_VERSION } from '../../test-support/kernel-engine';

function schema(): OrbitalSchema {
  return {
    typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
    name: 'topology-before-dispatch',
    version: '1.0.0',
    orbitals: [{
      name: 'NoteOrbital',
      entity: { name: 'Note', persistence: 'persistent', fields: [{ name: 'id', type: 'string' }, { name: 'title', type: 'string' }] },
      traits: [{
        name: 'NoteList',
        linkedEntity: 'Note',
        stateMachine: {
          states: [{ name: 'loading', isInitial: true }, { name: 'ready' }],
          events: [],
          transitions: [
            { from: 'loading', to: 'loading', event: 'INIT', effects: [['fetch', 'Note', { emit: { success: 'LOADED' } }]] },
            { from: 'loading', to: 'ready', event: 'LOADED', effects: [['render-ui', 'main', { type: 'typography', content: 'loaded' }]] },
          ],
        },
      }],
      pages: [{ name: 'NotePage', path: '/notes', traits: [{ ref: 'NoteList' }] }],
    }],
  } as OrbitalSchema;
}

function delayedRegisterStatelessTransport(s: OrbitalSchema, sends: Array<{ registered: boolean; request: EventRequest }>): EventTransport {
  const base = statelessKernelTransport(s);
  let registered = false;
  return {
    ...base,
    async register(schemaArg) {
      await new Promise((r) => setTimeout(r, 50));
      const result = await base.register(schemaArg);
      registered = true;
      return result;
    },
    async send(orbital, request) {
      sends.push({ registered, request });
      return base.send(orbital, request);
    },
  };
}

describe('mount dispatches wait for the bridge topology', () => {
  it('no event is posted before register() reports the topology; the INIT goes out stateless-shaped', async () => {
    const s = schema();
    const sends: Array<{ registered: boolean; request: EventRequest }> = [];
    render(
      <MemoryRouter>
        <OrbPreview schema={s} transport={delayedRegisterStatelessTransport(s, sends)} initialPagePath="/notes" isolated />
      </MemoryRouter>,
    );
    await screen.findByText('loaded', {}, { timeout: 10_000 });
    expect(sends.length).toBeGreaterThan(0);
    expect(sends.filter((x) => !x.registered).map((x) => x.request.event)).toEqual([]);
    expect(sends[0].request.traits).toBeDefined();
  }, 30_000);
});
