/**
 * Routes each leg where the kernel says it runs (EXEC-DIST-6): a `browser` leg runs in-process against the browser
 * store, a `server` leg goes to the server. The kernel sets `residence` on every leg and mount request it builds and
 * refuses a dispatch that needs both; this transport derives nothing from a trait's effects. A leg with no
 * `residence` (a stateful leg) carries no row work and goes to the server when there is one, else runs in-process.
 */
import type { EventRequest } from '@almadar/core';
import type { EventTransport } from '../../client/EventTransport.js';

export interface ResidenceTransportOptions {
  /** In-process transport over the browser store. */
  local: EventTransport;
  /** The server; absent on a static host. */
  remote?: EventTransport;
  /** The program's browser-stored entities (the kernel's `programSurface`): a row-set reference to one of them is resolved in-process. */
  browserEntities: ReadonlySet<string>;
}

export function createResidenceTransport(options: ResidenceTransportOptions): EventTransport {
  const { local, remote, browserEntities } = options;

  const route = (orbitalName: string, request: EventRequest): EventTransport => {
    if (request.residence === 'browser') return local;
    if (request.residence === 'server') {
      if (remote === undefined) throw new Error(`residence: a ${orbitalName} ${request.event} leg needs server data, and this host has no server`);
      return remote;
    }
    return remote ?? local;
  };

  return {
    async register(schema) {
      const result = await local.register(schema);
      return remote ? remote.register(schema) : result;
    },
    async unregister() {
      await local.unregister();
      await remote?.unregister();
    },
    async send(orbitalName, request) {
      return route(orbitalName, request).send(orbitalName, request);
    },
    async resolveRows(reference) {
      const owner = browserEntities.has(reference.entityType) ? local : remote;
      if (owner?.resolveRows === undefined) throw new Error(`residence: no transport resolves ${reference.entityType} row sets`);
      return owner.resolveRows(reference);
    },
    ...(remote?.subscribe ? { subscribe: remote.subscribe.bind(remote) } : {}),
  };
}
