import { storesRowsInBrowser } from '@almadar/core';

// src/runtime/evaluation/residence-transport.ts
function createResidenceTransport(options) {
  const { local, remote, traitIndex } = options;
  const browserStored = new Set(traitIndex.allEntities.filter(storesRowsInBrowser).map((e) => e.name));
  const route = (orbitalName, request) => {
    if (request.residence === "browser") return local;
    if (request.residence === "server") {
      if (remote === void 0) throw new Error(`residence: a ${orbitalName} ${request.event} leg needs server data, and this host has no server`);
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
      const owner = browserStored.has(reference.entityType) ? local : remote;
      if (owner?.resolveRows === void 0) throw new Error(`residence: no transport resolves ${reference.entityType} row sets`);
      return owner.resolveRows(reference);
    },
    ...remote?.subscribe ? { subscribe: remote.subscribe.bind(remote) } : {}
  };
}

export { createResidenceTransport };
