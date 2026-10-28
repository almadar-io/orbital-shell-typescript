// @vitest-environment jsdom
/**
 * A view of a program its host runs entirely (an extension's side panel over its worker): the view
 * keeps no browser store of its own, and a declared input the host runs while the view is open
 * shows in the view, with its data effects run once, on the host.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { OrbitalSchema, ServiceHostPorts } from '@almadar/core';
import { createChannelTransport, serveChannel, type ChannelMessage, type TransportChannel } from '../../index';
import { openBrowserHost } from '../../runtime';
import { OrbPreview } from '../OrbPreview';
import { TEST_LANGUAGE, loadTestKernel } from '../../test-support/kernel-engine';

function pair(): [TransportChannel, TransportChannel] {
  const a: Array<(m: ChannelMessage) => void> = [];
  const b: Array<(m: ChannelMessage) => void> = [];
  const make = (mine: typeof a, theirs: typeof a): TransportChannel => ({
    post: (m) => queueMicrotask(() => theirs.forEach((l) => l(structuredClone(m)))),
    onMessage: (l) => {
      mine.push(l);
      return () => mine.splice(mine.indexOf(l), 1);
    },
  });
  return [make(a, b), make(b, a)];
}

const program: OrbitalSchema = {
  name: 'host-runs-program',
  version: '1.0.0',
  typeContractVersion: 1,
  orbitals: [{
    name: 'Feed',
    entity: { name: 'Seen', persistence: 'persistent', collection: 'seen', browser: true, fields: [{ name: 'id', type: 'string' }, { name: 'title', type: 'string' }] },
    traits: [{
      name: 'Watch',
      linkedEntity: 'Seen',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [
          { key: 'INIT', name: 'INIT' },
          { key: 'WATCHING', name: 'WATCHING' },
          { key: 'ITEM_SEEN', name: 'ITEM_SEEN', input: true, payloadSchema: [{ name: 'title', type: 'string' }] },
        ],
        transitions: [
          { from: 'idle', to: 'idle', event: 'INIT', effects: [
            ['call-service', 'test-svc', 'watch', { match: 'https://example.com/*', selector: '.i', fields: {}, event: 'ITEM_SEEN' }, { emit: { success: 'WATCHING' } }],
            ['render-ui', 'main', { type: 'typography', variant: 'body', content: 'Watching' }],
          ] },
          { from: 'idle', to: 'idle', event: 'WATCHING', effects: [] },
          { from: 'idle', to: 'idle', event: 'ITEM_SEEN', effects: [
            ['persist', 'create', 'Seen', { title: '@payload.title' }],
            ['render-ui', 'main', { type: 'typography', variant: 'body', content: 'Seen an item' }],
          ] },
        ],
      },
    }, {
      name: 'SeenList',
      linkedEntity: 'Seen',
      stateMachine: {
        states: [{ name: 'ready', isInitial: true }],
        events: [{ key: 'INIT', name: 'INIT' }, { key: 'LIST_LOADED', name: 'LIST_LOADED' }],
        transitions: [
          { from: 'ready', to: 'ready', event: 'INIT', effects: [['fetch', 'Seen', { emit: { success: 'LIST_LOADED' } }]] },
          { from: 'ready', to: 'ready', event: 'LIST_LOADED', effects: [['render-ui', 'main', { type: 'typography', variant: 'body', content: 'The list the host loaded' }]] },
        ],
      },
    }],
    pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Watch' }, { ref: 'SeenList' }] }],
  }],
};

describe('a view of a program its host runs entirely', () => {
  it('shows a declared input the host ran, opens no store of its own, and saves the row once', async () => {
    let lent: ServiceHostPorts | undefined;
    const host = await openBrowserHost({ kernel: await loadTestKernel(), language: TEST_LANGUAGE,
      databaseName: 'almadar:host-runs-program',
      schema: program,
      callService: async (_s, _a, _p, context) => {
        lent = context?.host;
        return { watchId: 'w-1' };
      },
    });
    const [viewEnd, hostEnd] = pair();
    const served = serveChannel(hostEnd, host, { schemaName: program.name });
    host.onInputDispatched((orbital, request, response) => served.pushDispatch(orbital, request, response));

    render(<OrbPreview schema={program} transport={createChannelTransport(viewEnd, { hostsBrowserStore: true })} initialPagePath="/" />);
    await waitFor(() => expect(screen.getByText('Watching')).toBeTruthy());
    // A trait over the browser-stored entity with no service of its own is still the host's to run.
    await waitFor(() => expect(screen.getByText('The list the host loaded')).toBeTruthy());
    await waitFor(() => expect(lent).toBeDefined());

    await lent?.dispatchInput('Feed', { targetTrait: 'Watch', event: 'ITEM_SEEN', payload: { title: 'First' } });
    await waitFor(() => expect(screen.getByText('Seen an item')).toBeTruthy());

    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).toEqual(['almadar:host-runs-program']);
    const rows = await new Promise<number>((resolve) => {
      const open = indexedDB.open('almadar:host-runs-program');
      open.onsuccess = () => {
        const count = open.result.transaction('Seen').objectStore('Seen').count();
        count.onsuccess = () => resolve(count.result);
      };
    });
    expect(rows).toBe(1);
  });

  it('leaves the program\'s ticks to the host: the view sends none, and the host fires them once', async () => {
    const ticking: OrbitalSchema = {
      name: 'host-runs-ticks',
      version: '1.0.0',
      typeContractVersion: 1,
      orbitals: [{
        name: 'Pulse',
        entity: { name: 'Beat', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [{
          name: 'Beater', linkedEntity: 'Beat',
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }],
            events: [{ key: 'INIT', name: 'INIT' }, { key: 'PULSE', name: 'PULSE' }],
            transitions: [
              { from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', variant: 'body', content: 'Beating' }]] },
              { from: 'idle', to: 'idle', event: 'PULSE', effects: [] },
            ],
          },
          ticks: [{ name: 'pulse', interval: 30, effects: [['emit', 'PULSE']] }],
        }],
        pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Beater' }] }],
      }],
    };
    const host = await openBrowserHost({ kernel: await loadTestKernel(), language: TEST_LANGUAGE, databaseName: 'almadar:host-runs-ticks', schema: ticking, callService: async () => ({}) });
    const [viewEnd, hostEnd] = pair();
    const fromView: string[] = [];
    hostEnd.onMessage((m) => { if (m.almadarChannel === 'send') fromView.push(m.request.event); });
    const served = serveChannel(hostEnd, host, { schemaName: ticking.name });
    let hostPulses = 0;
    host.onInputDispatched((orbital, request, response) => {
      if (request.runTick?.tick === 'pulse' && response.emittedEvents.some((e) => e.event === 'PULSE')) hostPulses++;
      served.pushDispatch(orbital, request, response);
    });
    render(<OrbPreview schema={ticking} transport={createChannelTransport(viewEnd, { hostsBrowserStore: true })} initialPagePath="/" />);
    await waitFor(() => expect(screen.getByText('Beating')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 250));
    host.close();
    expect(fromView.filter((e) => e === 'PULSE')).toEqual([]);
    expect(hostPulses).toBeGreaterThan(2);
  });

  it('control: a view whose host does not keep the browser store opens its own', async () => {
    const schema: OrbitalSchema = { ...program, name: 'view-keeps-store' };
    const host = await openBrowserHost({ kernel: await loadTestKernel(), language: TEST_LANGUAGE, databaseName: 'almadar:view-keeps-store:host', schema, callService: async () => ({ watchId: 'w-1' }) });
    const [viewEnd, hostEnd] = pair();
    serveChannel(hostEnd, host, { schemaName: schema.name });
    render(<OrbPreview schema={schema} transport={createChannelTransport(viewEnd)} initialPagePath="/" />);
    await waitFor(async () => {
      const names = (await indexedDB.databases()).map((d) => d.name ?? '');
      expect(names.some((n) => n.startsWith('almadar:view-keeps-store:') && n !== 'almadar:view-keeps-store:host')).toBe(true);
    });
  });
});
