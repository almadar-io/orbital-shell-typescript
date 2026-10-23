import { defaultCallService } from './chunk-4SEK5ER2.js';
import { routeByEntity } from './chunk-O57GKTYU.js';
import { buildTraitIndex } from './chunk-CPSQXEJ6.js';
import { KernelEngine, evaluateOnKernel } from './chunk-MARJHUOC.js';
import { InFlightCalls } from './chunk-MZKIL5IN.js';
import { createInProcessTransport } from './chunk-QELZ6TEJ.js';
import { orbitalInlineEntities, storesRowsInBrowser, inlineTraitRefs, applyRowAccess, readableEntitiesOf, externalInputsOf, entityOwnerOrbital } from '@almadar/core';
import { entityAccessPolicies } from '@almadar/core/mock';

function localStorePersistence(schema, store, memory) {
  const browserStored = new Set(schema.orbitals.flatMap(orbitalInlineEntities).filter(storesRowsInBrowser).map((entity) => entity.name));
  return routeByEntity(browserStored, store, memory);
}
function openLocalKernel(options) {
  const { schema, persistence } = options;
  options.kernel.installLanguage(options.language);
  const callService = options.callService ?? defaultCallService;
  const engine = KernelEngine.open(options.kernel, { ...schema, orbitals: inlineTraitRefs(schema.orbitals) }, {
    persistence,
    callService: (service, action, params, context) => callService(service, action, params, context),
    programEffect: () => void 0,
    inFlightCalls: new InFlightCalls(),
    servicePorts: options.servicePorts ?? ((caller, user, message) => ({
      caller,
      message,
      inputs: () => externalInputsOf(schema),
      readableEntities: () => readableEntitiesOf(schema),
      dispatchInput: () => Promise.reject(new Error("a local store host takes no input dispatch")),
      read: async (entity) => applyRowAccess(await persistence.list(entity), entityAccessPolicies(schema, entity)?.read, void 0, { user }, entity)
    })),
    deliverLive: () => void 0,
    deferCallOutcome: options.deferCallOutcome ?? (() => void 0),
    ...options.pageFacts !== void 0 ? { pageFacts: options.pageFacts } : {},
    ...options.http !== void 0 ? { http: options.http } : {},
    ...options.onDevice !== void 0 ? { onDevice: options.onDevice } : {},
    ...options.tabs !== void 0 ? { tabs: options.tabs } : {}
  });
  if (options.messages !== void 0) engine.setMessages(Object.keys(options.messages), options.messages);
  engine.setTickMount([...buildTraitIndex(schema.orbitals).byName.keys()]);
  return engine;
}
function createLocalStoreTransport(options) {
  return createInProcessTransport(
    async (orbital, request) => evaluateOnKernel(
      {
        engine: await options.kernelEngine,
        orbital,
        ...options.outsideEventQueue !== void 0 ? { outsideEventQueue: options.outsideEventQueue } : {}
      },
      request,
      await options.user,
      request.locale
    ),
    {
      carriesCircuitState: false,
      ...options.schema !== void 0 ? { resolveRows: resolveOn(options, options.schema) } : {}
    }
  );
}
function resolveOn(options, schema) {
  return async (reference) => resolveLocalRows(await options.kernelEngine, schema, await options.user, reference);
}
function resolveLocalRows(engine, schema, user, reference) {
  const owner = entityOwnerOrbital(schema, reference.entityType);
  if (owner === void 0) return Promise.reject(new Error(`${reference.entityType}: no orbital of the local program declares this entity`));
  return engine.resolveRows(reference, { orbital: owner.name, ...user !== void 0 ? { user } : {} });
}

export { createLocalStoreTransport, localStorePersistence, openLocalKernel, resolveLocalRows };
