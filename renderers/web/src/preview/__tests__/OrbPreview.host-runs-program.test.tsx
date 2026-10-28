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
import { clientProgram } from '../../test-support/lolo-program';

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

const program: OrbitalSchema = clientProgram(`app host-runs-program [
  version: "1.0.0"
]

orbital Feed {
  entity Seen [persistent: seen, browser] {
    id : string!
    title : string = ""
  }

  trait Watch -> Seen {
    initial: idle

    state idle {
      INIT -> idle
        (call-service registry handles {} { emit: { success: WATCHING } })
        (render-ui main { type: "typography", variant: "body", content: "Watching" })
      WATCHING -> idle
      ITEM_SEEN -> idle
        (persist create Seen { title: ?title })
        (render-ui main { type: "typography", variant: "body", content: "Seen an item" })
    }

    listens {
      ITEM_SEEN -> input {
        title : string
      }
    }

    emits {
      WATCHING -> internal {
        watchId : string
      }
    }
  }

  trait SeenList -> Seen {
    initial: ready

    state ready {
      INIT -> ready
        (fetch Seen { emit: { success: LIST_LOADED } })
      LIST_LOADED -> ready
        (render-ui main { type: "typography", variant: "body", content: "The list the host loaded" })
    }

    emits {
      LIST_LOADED -> internal {
        data : [Seen]
      }
    }
  }

  page "/" as Home -> Watch, SeenList
}
`);

const ticking: OrbitalSchema = clientProgram(`app host-runs-ticks [
  version: "1.0.0"
]

orbital Pulse {
  entity Beat [runtime] {
    id : string!
  }

  trait Beater -> Beat [client] {
    initial: idle

    state idle {
      INIT -> idle
        (render-ui main { type: "typography", variant: "body", content: "Beating" })
      PULSE -> idle
    }

    ticks {
      pulse every 30ms
        (emit PULSE)
    }

    emits {
      PULSE -> internal
    }
  }

  page "/" as Home -> Beater
}
`);

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
  }, 20_000);

  it('leaves the program\'s ticks to the host: the view sends none, and the host fires them once', async () => {
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
  }, 20_000);

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
  }, 20_000);
});
