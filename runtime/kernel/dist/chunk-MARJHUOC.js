import { declareCapabilities, answerRequest } from './chunk-7MHD3WWR.js';
import { DispatchLane } from './chunk-53IPZXDP.js';
import { decodeResolveProgress, decodeProgress } from './chunk-RBUMDYFS.js';
import { installKernelEvaluator, EventStreamItemSchema, isEntityReferenceAny } from '@almadar/core';

function declaredEntityTypes(schema) {
  return schema.orbitals.flatMap((orbital) => [orbital.entity, ...orbital.auxiliaryEntities ?? []].flatMap((entity) => isEntityReferenceAny(entity) ? [] : [entity.name]));
}
var KernelEngine = class _KernelEngine {
  constructor(kernel, schemaJson, ports, entityTypes = [], store, forkedFrom, providedHandle, preserveProgramContext = false) {
    this.kernel = kernel;
    this.schemaJson = schemaJson;
    this.ports = ports;
    this.entityTypes = entityTypes;
    this.store = store;
    this.preserveProgramContext = preserveProgramContext;
    installKernelEvaluator(kernel);
    this.ports = {
      ...ports,
      substrateMessage: (site, key, value) => JSON.parse(kernel.osCompletionEvent(JSON.stringify({ ...site, emit: { success: site.emit.onMessage } }), key, JSON.stringify({ ok: value }))),
      substrateCompletion: (site, key, op, outcome) => JSON.parse(kernel.substrateCompletionEvent(JSON.stringify(site), key, op, JSON.stringify(outcome)))
    };
    this.handle = providedHandle ?? forkedFrom?.fork() ?? this.openServer();
    this.declare();
  }
  kernel;
  schemaJson;
  ports;
  entityTypes;
  store;
  preserveProgramContext;
  handle;
  lane = new DispatchLane();
  tickMount = [];
  messages = { locales: [], catalogs: {} };
  /**
   * A kernel on the same program, registered once, holding none of this one's session: every trait at its initial
   * state, no rows the kernel held, its locales and mounted ticks kept. A stateless host serves each request a
   * fork (EXEC-DIST-5), `ports` answering it.
   */
  fork(ports = this.ports) {
    const forked = new _KernelEngine(this.kernel, this.schemaJson, ports, this.entityTypes, this.store, this.handle, void 0, this.preserveProgramContext);
    forked.tickMount = this.tickMount;
    forked.messages = this.messages;
    return forked;
  }
  forkProgram(program, ports = this.ports) {
    const schemaJson = JSON.stringify(program);
    const entityTypes = [.../* @__PURE__ */ new Set([
      ...this.entityTypes,
      ...declaredEntityTypes(program)
    ])];
    return new _KernelEngine(this.kernel, schemaJson, ports, entityTypes, this.store, void 0, this.handle.forkProgram(schemaJson), true);
  }
  /** A server over the host's ports, or over the kernel's own store when `store` selects one (native add-on only). */
  openServer() {
    if (this.store === void 0) return new this.kernel.Server(this.schemaJson);
    const withStore = this.kernel.Server.withStore;
    if (withStore === void 0) throw new Error("a kernel store needs the native add-on (engine: 'native'); this kernel module has none");
    return withStore.call(this.kernel.Server, this.schemaJson, JSON.stringify(this.store));
  }
  declare() {
    if (this.store !== void 0) return;
    const handle = this.handle;
    declareCapabilities(this.ports.persistence, (entityType, queryJson, writeJson) => handle.setCapabilities(entityType, queryJson, writeJson), this.entityTypes);
  }
  static open(kernel, schema, ports, store) {
    return new _KernelEngine(kernel, JSON.stringify(schema), ports, declaredEntityTypes(schema), store);
  }
  /** A fresh kernel on the same program: every trait back at its initial state. */
  reset() {
    const contextualHandle = this.preserveProgramContext ? this.handle.fork() : void 0;
    this.handle.free();
    this.handle = contextualHandle ?? this.openServer();
    this.declare();
    this.handle.setTickMount(JSON.stringify(this.tickMount));
    this.handle.setMessages(JSON.stringify(this.messages.locales), JSON.stringify(this.messages.catalogs));
    if (this.managedProgram !== void 0) this.handle.setManagedProgram(this.managedProgram);
  }
  managedProgram;
  /** The program whose declared credentials this kernel's credential effects manage beside its own (a console's app). */
  setManagedProgram(program) {
    this.managedProgram = JSON.stringify(program);
    this.handle.setManagedProgram(this.managedProgram);
  }
  /** The program's declared locales and merged catalogs (a lazy page's behavior contributes its namespaced keys). */
  setMessages(locales, catalogs) {
    this.messages = { locales, catalogs };
    this.handle.setMessages(JSON.stringify(locales), JSON.stringify(catalogs));
  }
  /** The traits some client has mounted: a tick that is not `[background]` fires only for these. */
  setTickMount(traits) {
    this.tickMount = traits;
    this.handle.setTickMount(JSON.stringify(traits));
  }
  /** Mock-seed the `[runtime]` entities the kernel holds itself, owner columns stamped with `viewerId`. */
  seedRuntimeMock(viewerId) {
    this.handle.seedRuntimeMock(viewerId);
  }
  dispose() {
    this.handle.free();
  }
  liveItemDelivered(item, viewer, clientId) {
    return this.handle.liveItemDelivered(JSON.stringify(item), JSON.stringify(viewer), clientId);
  }
  /** `OsGrants::allows` over the grants of the program this kernel runs. */
  osAllows(requirementJson) {
    return this.handle.osAllows(requirementJson);
  }
  /** Place the program's anchored grants and arguments under the host's anchors. */
  setOsAnchors(anchorsJson) {
    return this.handle.setOsAnchors(anchorsJson);
  }
  /** An `os/` call's arguments with its anchored parts resolved under the host's anchors. */
  osResolveArgs(op, argsJson) {
    return this.handle.osResolveArgs(op, argsJson);
  }
  /** The current state of a trait instance, `''` when it has none. */
  stateOf(traitName, entityId) {
    return this.handle.getState(traitName, entityId);
  }
  /**
   * `reference` resolved for `scope.user` against the host-answered store (EXEC-RENDER-3): the rows that still
   * match its query and the viewer's `@read` in the reference's order, a missing or hidden row omitted, and `total`
   * re-counted (a `total: none` reference is not re-counted: the total is the resolved window). Each read the
   * kernel makes is answered here, as in `evaluate`.
   */
  async resolveRows(reference, scope) {
    const handle = this.handle;
    let progress = decodeResolveProgress(handle.resolveRows(JSON.stringify(reference), JSON.stringify(scope.user ?? null)));
    while (progress.status === "await") {
      const { flight, requests } = progress;
      let replies;
      try {
        replies = await Promise.all(
          requests.map(async (pending) => ({ id: pending.id, answer: await answerRequest(this.ports, pending.request, scope) }))
        );
      } catch (error) {
        handle.abandon(flight);
        throw error;
      }
      progress = decodeResolveProgress(handle.resumeResolve(flight, JSON.stringify(replies)));
    }
    return { rows: progress.rows, total: progress.total };
  }
  /** Run `request` against `orbital`: start it, answer every request the kernel asks for, resume until done. */
  async evaluate(orbital, request, scope) {
    const guard = await this.lane.enter();
    try {
      const handle = this.handle;
      let progress = decodeProgress(handle.start(orbital, JSON.stringify(request)));
      while (progress.status === "await") {
        const { flight, requests } = progress;
        let replies;
        guard.park(request.event);
        try {
          replies = await Promise.all(
            requests.map(async (pending) => ({ id: pending.id, answer: await answerRequest(this.ports, pending.request, { ...scope, assertReentry: () => this.lane.assertCanReenter(guard.turn) }) }))
          );
        } catch (error) {
          handle.abandon(flight);
          throw error;
        }
        guard.resume();
        progress = decodeProgress(handle.resume(flight, JSON.stringify(replies)));
      }
      if (scope.onStream !== void 0) {
        const items = EventStreamItemSchema.array().parse(JSON.parse(handle.dispatchStream()));
        for (const item of items) scope.onStream(item);
      }
      return progress.response;
    } finally {
      guard.release();
    }
  }
};
function kernelRequest(request, user, locale) {
  const { _activeTraits: _dropped, _targetTrait: sidecarTarget, ...rest } = request.payload ?? {};
  const payload = rest;
  const target = request.targetTrait ?? (typeof sidecarTarget === "string" ? sidecarTarget : void 0);
  const { payload: _payload, ...others } = request;
  return {
    ...others,
    ...request.payload !== void 0 ? { payload } : {},
    ...target !== void 0 ? { targetTrait: target } : {},
    ...user !== void 0 ? { user } : {},
    ...locale !== void 0 ? { locale } : {}
  };
}
function withOriginClient(response, clientId) {
  if (clientId === void 0) return response;
  return {
    ...response,
    emittedEvents: response.emittedEvents.map((emitted) => emitted.source === void 0 ? emitted : { ...emitted, source: { ...emitted.source, originClientId: emitted.source.originClientId ?? clientId } })
  };
}
async function evaluateOnKernel(kernel, request, user, locale) {
  return withOriginClient(await kernel.engine.evaluate(kernel.orbital, kernelRequest(request, user, locale), {
    orbital: kernel.orbital,
    ...user !== void 0 ? { user } : {},
    ...request.clientId !== void 0 ? { originClientId: request.clientId } : {},
    ...locale !== void 0 ? { locale } : {},
    ...request.entityId !== void 0 ? { entityId: request.entityId } : {},
    ...kernel.onStream !== void 0 ? { onStream: (item) => {
      if (item.type === "event" && item.data.source !== void 0 && request.clientId !== void 0) {
        kernel.onStream?.({ ...item, data: { ...item.data, source: { ...item.data.source, originClientId: item.data.source.originClientId ?? request.clientId } } });
      } else if (item.type === "complete") {
        kernel.onStream?.({ ...item, data: withOriginClient(item.data, request.clientId) });
      } else kernel.onStream?.(item);
    } } : {},
    ...kernel.outsideEventQueue !== void 0 ? { outsideEventQueue: kernel.outsideEventQueue } : {}
  }), request.clientId);
}

export { KernelEngine, evaluateOnKernel, kernelRequest };
