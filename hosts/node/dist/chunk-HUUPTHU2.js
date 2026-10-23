import { installNodeHostPorts } from './chunk-23YAOI6P.js';
import { nativeMemoryOf } from './chunk-UBZT5LDW.js';
import { createTickScheduler, EventBus, parseOrbitalTraits, bindDeclaredCollections, createHttpPorts, defaultCallService, kernelOsCompletions, stampEmitSource, eventRouteKey, kernelOsGrants, KernelEngine, StdMockSeed, declaredSeedConfig, seedMockStore, seedBrowserStore, isValidCronExpression, parseDurationString, restampMockOwner, dispatchDeclaredInput, dispatchInbound, createHttpSecrets, evaluateOnKernel, InFlightCalls } from '@almadar/shell-runtime';
import { ANONYMOUS_USER, installKernelEvaluator, isEntityCall, inlineTraitRefs, tickEventKey, entityOwnerOrbital, personaFromIdentityRow, externalInputsOf, applyRowAccess, readableEntitiesOf, inboundOnlyTrait, inboundOnlyMessage, UNMOUNT_EVENT, LIFECYCLE_EVENTS, normalizeUserContext } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import { identityEntityName, entityAccessPolicies } from '@almadar/core/mock';

var effectLog = createLogger("almadar:runtime:effects");
var busLog = createLogger("almadar:runtime:bus");
var renderLog = createLogger("almadar:runtime:render-ui");
var xOrbitalLog = createLogger("almadar:runtime:cross-orbital");
createLogger("almadar:runtime:persist");
var STD_MOCK_SEED = "std/behaviors/std-mock-seed";
var registerLog = createLogger("almadar:runtime:register");
function isNodeEnv() {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}
var UnresolvedProgramError = class extends Error {
  constructor(schemaName) {
    super(`program "${schemaName}" has unresolved imports and this host cannot run orb: register its resolved form (orb resolve)`);
    this.name = "UnresolvedProgramError";
  }
};
function needsResolving(schema) {
  for (const orbital of schema.orbitals) {
    for (const t of orbital.traits ?? []) {
      if (typeof t === "object" && "ref" in t && t.ref.includes(".") && t._resolved === void 0) {
        return true;
      }
    }
  }
  return false;
}
async function readSidecarCatalogs(readFile, orbPath, locales) {
  const messages = {};
  const stem = orbPath.replace(/\.orb$/, "");
  for (const locale of locales) {
    const catalogPath = `${stem}.${locale}.json`;
    let catalogRaw;
    try {
      catalogRaw = await readFile(catalogPath, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`registerFromFile: ${orbPath} declares locale "${locale}" but its catalog ${catalogPath} could not be read: ${msg}`);
    }
    messages[locale] = JSON.parse(catalogRaw);
  }
  return messages;
}
var OrbitalServerRuntime = class {
  orbitals = /* @__PURE__ */ new Map();
  eventBus;
  config;
  /** The row store a host-supplied `persistence` replaces: the kernel's own `MemoryStore`, opened by the first `register()`. */
  ownedStore;
  /** The owner cells the mock seed stamped, kept for a persona restamp. */
  mockJournal;
  /** The std seed program resolved from the installed packages, once per runtime. */
  seedProgram;
  /** Store writes (seed, reseed, restamp) run one after another. */
  storeOps = Promise.resolve();
  /**
   * The bound persistence adapter (host-supplied, else the kernel's own memory store). Public so a test can
   * inspect committed rows honestly. A runtime that owns its store has one from the first `register()`.
   */
  get persistence() {
    const store = this.config.persistence ?? this.ownedStore;
    if (store === void 0) throw new Error("OrbitalServerRuntime: the runtime opens its store when a program is registered; none is registered yet");
    return store;
  }
  /** Whether this runtime seeds generated mock rows: mock mode over the store it owns. */
  seedsMock() {
    return this.config.mode === "mock" && this.config.persistence === void 0;
  }
  tickBindings = [];
  /** The kernel running the registered program; null before a program is registered. */
  kernelEngine = null;
  /** The `os` handles of the program the kernel runs; closed when that program is replaced, reset or dropped. */
  kernelOs;
  /** `orbital::trait` → the clients that have it mounted (Runtime Spec Clause 8.3). */
  mountedBy = /* @__PURE__ */ new Map();
  // One coalesced clock for every tick this runtime registers — replaces
  // "one setInterval per tick" with a single accumulator loop so ticks due
  // in the same pass fire together instead of on independent timers.
  tickScheduler = createTickScheduler();
  transitionObservers = /* @__PURE__ */ new Set();
  transitionFanout = {
    onTransition: (trace) => {
      for (const o of this.transitionObservers) o.onTransition(trace);
    },
    onRollback: (trace) => {
      for (const o of this.transitionObservers) o.onRollback?.(trace);
    }
  };
  programHandlersPromise = null;
  resolvedSchema = null;
  /** The program's declared `locales`, in declared order; the first is the default. */
  appLocales = [];
  /** Merged message catalogs of every registered program (keys are behavior-qualified). */
  messages = {};
  /** Wired by the hosting server (e.g. the playground SSE endpoint) via `setLiveBroadcastSink`. */
  liveSubscribers = /* @__PURE__ */ new Set();
  liveBroadcastSink = null;
  hostDispatchSink = null;
  /**
   * Tick-broadcast relay (T6): newest pending item per
   * (originClientId, orbital, event), flushed to the live-broadcast sink on
   * the `tickRelayIntervalMs` cadence — other tabs get the latest position
   * at snapshot rate, never 1:1 with emissions.
   */
  tickRelayPending = /* @__PURE__ */ new Map();
  tickRelayTimer = null;
  constructor(config) {
    installNodeHostPorts();
    this.config = {
      ...config,
      // `@user` is never Null: a host that named no viewer and has no sign-in serves the unauthenticated viewer.
      defaultUser: config.defaultUser ?? ANONYMOUS_USER
    };
    this.viewerNamedByHost = config.defaultUser !== void 0;
    this.eventBus = new EventBus();
  }
  /**
   * Lazily wire the program host handlers (behavior/* and program/* effects),
   * merging them UNDER any user-provided handlers. Only when `programHost`
   * is configured; otherwise the effects fail explicitly.
   */
  async ensureProgramHandlers() {
    if (!isNodeEnv()) return;
    const host = this.config.programHost;
    if (host === void 0) return;
    if (!this.programHandlersPromise) {
      this.programHandlersPromise = (async () => {
        const { createProgramHandlers } = await import('./createProgramHandlers.js');
        this.config.effectHandlers = {
          ...createProgramHandlers(host),
          ...this.config.effectHandlers
        };
      })();
    }
    return this.programHandlersPromise;
  }
  // ==========================================================================
  // Schema Registration
  // ==========================================================================
  /**
   * Register an OrbitalSchema for execution.
   *
   * Auto-preprocesses the schema when it contains `uses` declarations or
   * unresolved cross-orbital trait references (e.g. a trait with
   * `ref: "Modal.traits.ModalRecordModal"` and no inline `stateMachine`).
   * Without preprocessing, those refs arrive empty at the state machine and
   * button clicks silently do nothing — see Phase 9.5.H.
   *
   * Preprocessing needs a loader. If `loaderConfig` is set, that loader is
   * used. Otherwise, a default loader is constructed that points at
   * `<cwd>` (for `basePath`) and the nearest `node_modules/@almadar/std` (for
   * `stdLibPath`), which matches how every caller in this monorepo has the
   * std registry on disk.
   */
  /**
   * The in-flight (or last-completed) app mutation — `register()` chains its
   * body onto this, and `unregisterAll()` stamps a marker after clearing.
   * `processOrbitalEvent` consults it when the requested orbital is missing:
   * during a catalog-style app swap the new schema's registration is already
   * in flight while a client's first events arrive, and answering those with
   * an immediate `Orbital not found` 404 (the pre-fix behavior) races the
   * swap — big multi-orbital organisms lost their mount INITs intermittently
   * while single-orbital ones almost always won. Awaiting the epoch and
   * re-reading the map turns the race into a brief wait. `BrowserPlayground`
   * gated dispatches on registration ad hoc for the same race; the epoch is
   * the canonical, host-wide fix.
   */
  registrationEpoch = null;
  /**
   * Reentrancy guard for `withRegistrationMutation`. While a bracket is
   * open, `register()`/`unregisterAll()` must NOT chain/stamp the epoch:
   * the callback's sequential awaits already order them, and chaining a
   * `register()` awaited by the callback onto the bracket's gate would
   * deadlock (callback → register → epoch → gate → callback's finally).
   */
  registrationMutationDepth = 0;
  async register(schema, options = {}) {
    if (this.registrationMutationDepth > 0) {
      await this.doRegister(schema, options);
      return;
    }
    const previous = this.registrationEpoch ?? Promise.resolve();
    const epoch = previous.then(
      () => this.doRegister(schema, options),
      () => this.doRegister(schema, options)
    );
    this.registrationEpoch = epoch;
    await epoch;
  }
  async doRegister(schema, options) {
    const kernel = await this.kernelModule();
    installKernelEvaluator(kernel);
    this.openOwnedStore(kernel);
    if (this.config.debug) {
      registerLog.debug("register:schema", { name: schema.name });
    }
    this.appLocales = schema.locales ?? [];
    for (const [locale, catalog] of Object.entries(options.messages ?? {})) {
      this.messages[locale] = { ...this.messages[locale], ...catalog };
    }
    if (needsResolving(schema)) schema = await this.resolveWithOrb(schema);
    const lazyOrbitals = (options.lazy ?? []).flatMap((lazy) => lazy.orbitals);
    const executed = lazyOrbitals.length > 0 ? { ...schema, orbitals: [...schema.orbitals, ...lazyOrbitals] } : schema;
    for (const orbital of executed.orbitals) {
      await this.registerOrbitalAsync(orbital);
    }
    this.setupTicks();
    await this.openKernel(executed);
    this.resolvedSchema = schema;
    await this.flushPendingOwnerRestamp();
  }
  /** The kernel's own row store, opened once in the register phase when the host supplied none. */
  openOwnedStore(kernel) {
    if (this.config.persistence !== void 0 || this.ownedStore !== void 0) return;
    this.ownedStore = nativeMemoryOf(kernel);
  }
  /**
   * Returns the schema that this runtime is currently executing, post-
   * preprocessing. Safe to expose from an HTTP `/api/schema` endpoint — every
   * cross-orbital trait ref will have an inline `stateMachine` already, which
   * is what the browser's `schema-to-ir` resolver needs to wire button clicks
   * back to state transitions.
   *
   * Returns `null` if `register()` hasn't run yet.
   */
  /** The registered program's name, or null when nothing is registered (none yet, or after `unregisterAll`). */
  registeredSchemaName() {
    return this.orbitals.size > 0 ? this.resolvedSchema?.name ?? null : null;
  }
  getResolvedSchema() {
    return this.resolvedSchema;
  }
  /** The registered program's message catalogs (locale → qualified key → message), for a host's client. */
  getMessages() {
    return this.messages;
  }
  /**
   * One-call entry point: read an `.orb` file from disk, parse it, preprocess
   * cross-orbital imports, and register the result. Callers never touch raw
   * `.orb` bytes — `register()` handles preprocessing internally.
   *
   * Node only. Browsers must receive already-resolved schemas from their
   * server (see `getResolvedSchema()`).
   */
  async registerFromFile(path) {
    if (typeof process === "undefined" || !process.versions?.node) {
      throw new Error(
        "registerFromFile is Node-only. Browsers should receive resolved schemas from their server."
      );
    }
    const { readFile } = await import('fs/promises');
    const raw = await readFile(path, "utf-8");
    let schema;
    try {
      schema = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`registerFromFile: ${path} is not valid JSON: ${msg}`);
    }
    const locales = schema.locales ?? [];
    const messages = await readSidecarCatalogs(readFile, path, locales);
    const { dirname, join } = await import('path');
    const lazy = [];
    for (const page of schema.lazyPages ?? []) {
      const lazyPath = join(dirname(path), page.orbRef);
      let lazyRaw;
      try {
        lazyRaw = await readFile(lazyPath, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`registerFromFile: ${path} declares lazy page ${page.path} but its behavior ${page.orbRef} could not be read: ${msg}`);
      }
      const lazySchema = JSON.parse(lazyRaw);
      if (!lazySchema.orbitals.some((o) => o.name === page.orbital)) {
        throw new Error(`registerFromFile: lazy page ${page.path} expects orbital "${page.orbital}" in ${page.orbRef}, found: ${lazySchema.orbitals.map((o) => o.name).join(", ")}`);
      }
      lazy.push(lazySchema);
      for (const [locale, catalog] of Object.entries(await readSidecarCatalogs(readFile, lazyPath, locales))) {
        messages[locale] = { ...messages[locale], ...catalog };
      }
    }
    await this.register(schema, { messages, lazy });
  }
  /** A program with imports resolved by `orb` from the configured base path (Node only: the one resolver is the compiler). */
  async resolveWithOrb(schema) {
    if (!isNodeEnv()) throw new UnresolvedProgramError(schema.name);
    const { programResolveSchema } = await import('./program-RR7FNBJX.js');
    const cwd = this.programRoot();
    if (this.config.debug) registerLog.debug("register:resolve-with-orb", { name: schema.name, cwd });
    return programResolveSchema(schema, { cwd, ...this.config.programHost?.orbBin !== void 0 ? { orbBin: this.config.programHost.orbBin } : {} });
  }
  /**
   * Register a single orbital
   */
  async registerOrbitalAsync(orbital) {
    const { inlineTraits, configByTrait, entity } = parseOrbitalTraits(orbital);
    this.orbitals.set(orbital.name, {
      schema: orbital,
      entity,
      traits: inlineTraits,
      configByTrait
    });
    const auxiliary = (orbital.auxiliaryEntities ?? []).filter((ref) => typeof ref !== "string" && !isEntityCall(ref));
    bindDeclaredCollections(this.persistence, [entity, ...auxiliary]);
    if (this.config.debug) {
      registerLog.debug("register:orbital", {
        name: orbital.name,
        traitCount: (orbital.traits || []).length
      });
    }
  }
  /** The adapters the kernel's I/O is answered with: this runtime's persistence, services and program host. */
  httpPorts(egress = this.resolvedSchema?.egress ?? []) {
    const options = this.config.http;
    return options === void 0 ? void 0 : createHttpPorts({ ...options, egress });
  }
  kernelPorts(egress) {
    const http = this.httpPorts(egress);
    return {
      ...http !== void 0 ? { http } : {},
      ...this.config.clock !== void 0 ? { now: this.config.clock } : {},
      ...this.kernelOs !== void 0 ? { os: this.kernelOs } : {},
      ...this.kernelOs !== void 0 && this.config.kernel !== void 0 ? { osCompletions: kernelOsCompletions(this.config.kernel) } : {},
      persistence: this.persistence,
      inFlightCalls: this.inFlightCalls,
      callService: (service, action, params, context) => {
        const provider = this.config.effectHandlers?.callService;
        if (provider !== void 0) return provider(service, action, params, context);
        return defaultCallService(service, action, params, context);
      },
      programEffect: () => this.config.effectHandlers?.programEffect,
      substrateStream: (op, args) => {
        if (op !== "program/live") return void 0;
        const first = args[0];
        const options = first !== null && typeof first === "object" && !Array.isArray(first) ? first : {};
        const rawViewer = options["viewer"];
        const viewer = rawViewer !== null && typeof rawViewer === "object" && !Array.isArray(rawViewer) ? rawViewer : null;
        const clientId = typeof options["clientId"] === "string" ? options["clientId"] : void 0;
        return {
          subscribe: (message) => {
            const receive = (item) => {
              if (this.requireKernelEngine().liveItemDelivered(item, viewer, clientId)) message(JSON.parse(JSON.stringify({ event: item.event, ...item.payload !== void 0 ? { payload: item.payload } : {}, source: item.source })));
            };
            this.liveSubscribers.add(receive);
            return () => {
              this.liveSubscribers.delete(receive);
            };
          }
        };
      },
      servicePorts: (caller, user, message, assertReentry) => this.servicePorts(caller, user, message, assertReentry),
      deliverLive: (site, payload, originClientId) => this.deliverLiveMessage(site, payload, originClientId),
      deferCallOutcome: () => (call) => this.runDeferredOutcome(call.orbital, {
        event: call.event,
        ...call.payload !== void 0 ? { payload: call.payload } : {},
        targetTrait: call.traitName,
        ...call.entityId !== void 0 ? { entityId: call.entityId } : {},
        ...call.originClientId !== void 0 ? { clientId: call.originClientId } : {},
        ...call.user !== void 0 ? { user: call.user } : {},
        ...call.locale !== void 0 ? { locale: call.locale } : {}
      })
    };
  }
  /** One live message of a running `call-service`, stamped as its calling trait, to the requesting tab only. */
  deliverLiveMessage(site, payload, originClientId) {
    const registered = this.orbitals.get(site.orbital);
    const callingTrait = registered?.traits.find((t) => t.name === site.trait);
    const stamp = stampEmitSource(void 0, {
      orbitalName: site.orbital,
      traitName: site.trait,
      orbitalId: registered?.schema.id,
      traitId: callingTrait?.id,
      emitContractEventId: callingTrait?.emits?.find((e) => e.event === site.event)?.eventId,
      originClientId
    });
    this.eventBus.emit(site.event, payload, stamp, eventRouteKey(site.event, stamp.eventId));
    this.publishLiveItem({ event: site.event, payload, source: stamp, originClientId, target: "origin" });
  }
  /** The project root this runtime hands `orb` and the kernel's language data: the program host's cwd, else the loader base path. */
  programRoot() {
    return this.config.programHost?.cwd ?? this.config.loaderConfig?.basePath ?? process.cwd();
  }
  /** The kernel module this runtime runs on: the one the host handed in, else the installed `@almadar/kernel`. */
  async kernelModule() {
    if (this.config.kernel !== void 0) return this.config.kernel;
    const { loadInstalledKernel } = await import('./kernel-loader-24KWM5C7.js');
    this.config.kernel = await loadInstalledKernel(this.programRoot());
    return this.config.kernel;
  }
  /** (Re)open the kernel on the program just registered. */
  async openKernel(registered) {
    const kernel = await this.kernelModule();
    const schema = { ...registered, orbitals: inlineTraitRefs(registered.orbitals) };
    for (const orbital of schema.orbitals) {
      for (const trait of orbital.traits ?? []) {
        if (typeof trait === "object" && "ref" in trait && !("stateMachine" in trait)) {
          throw new Error(`OrbitalServerRuntime: the kernel takes an orb-resolved program, but trait "${trait.ref}" of orbital "${orbital.name}" is still a reference`);
        }
      }
    }
    this.inFlightCalls.cancelAll();
    this.kernelEngine?.dispose();
    this.kernelOs?.close();
    this.kernelOs = this.config.osHost?.(kernelOsGrants(kernel, () => this.requireKernelEngine()));
    this.kernelEngine = KernelEngine.open(kernel, schema, this.kernelPorts(registered.egress ?? []));
    this.kernelEngine.setMessages(this.appLocales, this.messages);
    if (this.managedProgram !== void 0) this.kernelEngine.setManagedProgram(this.managedProgram);
    await this.seedStores(registered);
    this.seedKernelRuntimeMock();
    this.syncTickMount();
  }
  /** The program whose rows the store holds, once seeded; absent before the first seed and after `unregisterAll`. */
  seededProgram;
  /** The std mock-seed program, resolved by `orb` from the installed packages. */
  async resolveSeedProgram() {
    if (this.seedProgram !== void 0) return this.seedProgram;
    const { behaviorResolve } = await import('./program-RR7FNBJX.js');
    const resolved = await behaviorResolve(
      { behavior: STD_MOCK_SEED },
      { cwd: this.programRoot(), ...this.config.programHost?.orbBin !== void 0 ? { orbBin: this.config.programHost.orbBin } : {} }
    );
    if (!("orbitals" in resolved)) throw new Error(`OrbitalServerRuntime: the mock seed program ${STD_MOCK_SEED} did not resolve: ${resolved.error}`);
    this.seedProgram = resolved;
    return resolved;
  }
  /** Run `use` with the seed program forked off the kernel just opened; the fork is released after. */
  async withSeeder(user, use) {
    const program = await this.resolveSeedProgram();
    const seedEngine = this.requireKernelEngine().forkProgram(program);
    try {
      return await use({
        seeder: new StdMockSeed(seedEngine, declaredSeedConfig(program, this.resolvedSchema ?? void 0), user),
        persistence: this.persistence,
        nowMs: this.config.clock?.() ?? Date.now()
      });
    } finally {
      seedEngine.dispose();
    }
  }
  /** Store writes (seed, reseed, restamp) run one after another, so a persona switch never interleaves a reseed. */
  enqueueStoreOp(op) {
    const run = this.storeOps.then(op, op);
    this.storeOps = run.catch(() => void 0);
    return run;
  }
  /**
   * Fill the store from the program, in the register phase: a mock runtime seeds every entity for the viewer, any
   * other runtime seeds the rows the program writes out and its browser-stored entities.
   */
  async seedStores(program) {
    if (this.seedsMock()) {
      const named = this.viewerNamedByHost ? this.config.defaultUser : void 0;
      const seeded = await this.withSeeder(named, (host) => seedMockStore(host, program, {
        namedByHost: this.viewerNamedByHost,
        current: () => this.config.defaultUser,
        seedIdentity: true
      }));
      this.mockJournal = seeded.journal;
      if (!this.viewerNamedByHost) this.config.defaultUser = seeded.viewer;
      this.seededProgram = program;
      return;
    }
    const local = [];
    for (const registered of this.orbitals.values()) {
      if (registered.entity.local === true) local.push(registered.entity);
      for (const aux of registered.schema.auxiliaryEntities ?? []) {
        if (typeof aux !== "string" && !isEntityCall(aux) && aux.local === true) local.push(aux);
      }
    }
    if (local.length === 0) return;
    await this.withSeeder(void 0, (host) => seedBrowserStore(host.persistence, local, void 0, host));
  }
  managedProgram;
  /**
   * Name the program whose declared credentials this runtime's credential effects manage beside its own: an
   * integrations console serving the app a host shows saves and tests that app's keys. Naming another replaces it.
   */
  manageCredentialsOf(program) {
    this.managedProgram = program;
    this.kernelEngine?.setManagedProgram(program);
  }
  /** A mock store seeds every entity; the `[runtime]` rows the kernel holds itself are seeded in the kernel. */
  seedKernelRuntimeMock() {
    if (!this.seedsMock()) return;
    this.kernelEngine?.seedRuntimeMock(this.config.defaultUser?.id);
  }
  requireKernelEngine() {
    if (this.kernelEngine === null) throw new Error("OrbitalServerRuntime: an os ask arrived with no kernel program registered");
    return this.kernelEngine;
  }
  /**
   * Set up scheduled ticks for all traits
   */
  setupTicks() {
    this.cleanupTicks();
    for (const [orbitalName, registered] of this.orbitals) {
      for (const trait of registered.traits || []) {
        if (!trait.ticks || trait.ticks.length === 0) continue;
        for (const tick of trait.ticks) {
          this.registerTick(orbitalName, trait.name, tick);
        }
      }
    }
    if (this.config.debug && this.tickBindings.length > 0) {
      registerLog.debug("register:ticks", { count: this.tickBindings.length });
    }
  }
  /**
   * Register a single tick
   */
  registerTick(orbitalName, traitName, tick) {
    if (typeof tick.interval === "string" && isValidCronExpression(tick.interval)) {
      if (this.config.debug) {
        registerLog.debug("register:tick-cron", {
          orbital: orbitalName,
          trait: traitName,
          tick: tick.name,
          expression: tick.interval
        });
      }
      const handle2 = this.tickScheduler.addCron(tick.interval, () => {
        void this.executeTick(orbitalName, traitName, tick);
      });
      this.tickBindings.push({ orbitalName, traitName, tick, handle: handle2 });
      return;
    }
    let intervalMs;
    if (typeof tick.interval === "number") {
      intervalMs = tick.interval;
    } else if (typeof tick.interval === "string") {
      intervalMs = parseDurationString(tick.interval);
    } else {
      intervalMs = 1e3;
    }
    if (this.config.debug) {
      registerLog.debug("register:tick", {
        orbital: orbitalName,
        trait: traitName,
        tick: tick.name,
        intervalMs
      });
    }
    const handle = this.tickScheduler.add(intervalMs, () => {
      void this.executeTick(orbitalName, traitName, tick);
    });
    this.tickBindings.push({
      orbitalName,
      traitName,
      tick,
      handle
    });
  }
  /** A tick: the host owns the timer, the kernel decides whether and over which rows it fires. */
  async executeTick(orbitalName, traitName, tick) {
    const response = await this.processOrbitalEvent(orbitalName, {
      event: tickEventKey(tick.name),
      runTick: { trait: traitName, tick: tick.name },
      targetTrait: traitName
    });
    if (!response.success) {
      effectLog.error("tick:execute-error", { tick: tick.name, error: response.error ?? "the kernel refused the tick" });
    }
  }
  /** Tell the kernel which traits some client has mounted, so it can pause the other traits' ticks. */
  syncTickMount() {
    if (this.kernelEngine === null) return;
    const traits = /* @__PURE__ */ new Set();
    for (const key of this.mountedBy.keys()) traits.add(key.split("::")[1] ?? "");
    this.kernelEngine.setTickMount([...traits]);
  }
  /**
   * Clean up all active ticks
   */
  cleanupTicks() {
    for (const binding of this.tickBindings) {
      binding.handle.stop();
    }
    this.tickBindings = [];
  }
  /**
   * Unregister all orbitals and clean up
   */
  /** A client mounts a trait by dispatching its lifecycle event and releases it with `$UNMOUNT`. */
  recordMount(orbitalName, request, mounted) {
    const client = request.clientId;
    if (client === void 0) return;
    const traits = request.mount !== void 0 ? request.mount.map((m) => m.trait) : request.targetTrait !== void 0 ? [request.targetTrait] : (request.traits ?? []).map((t) => t.trait);
    for (const traitName of traits) {
      const key = `${orbitalName}::${traitName}`;
      const clients = this.mountedBy.get(key) ?? /* @__PURE__ */ new Set();
      if (mounted) clients.add(client);
      else clients.delete(client);
      if (clients.size > 0) this.mountedBy.set(key, clients);
      else this.mountedBy.delete(key);
    }
    this.syncTickMount();
  }
  /** Drop every mount a disconnected client held, so its traits' mount-scoped ticks pause. */
  releaseClient(clientId) {
    for (const [key, clients] of this.mountedBy) {
      clients.delete(clientId);
      if (clients.size === 0) this.mountedBy.delete(key);
    }
    this.syncTickMount();
  }
  /** True while at least one client has `traitName` mounted. */
  isTraitMounted(orbitalName, traitName) {
    return (this.mountedBy.get(`${orbitalName}::${traitName}`)?.size ?? 0) > 0;
  }
  unregisterAll() {
    this.cleanupTicks();
    this.mountedBy.clear();
    this.orbitals.clear();
    this.inFlightCalls.cancelAll();
    this.kernelEngine?.dispose();
    this.kernelEngine = null;
    this.kernelOs?.close();
    this.kernelOs = void 0;
    this.eventBus.clear();
    this.messages = {};
    this.appLocales = [];
    if (this.seedsMock()) this.ownedStore?.clear();
    this.mockJournal = void 0;
    this.seededProgram = void 0;
    this.programHandlersPromise = null;
    if (this.registrationMutationDepth === 0) {
      this.registrationEpoch = (this.registrationEpoch ?? Promise.resolve()).then(() => void 0, () => void 0);
    }
  }
  /**
   * Bracket a multi-step app mutation (the classic swap is
   * `unregisterAll()` → resolve next schema → `register()`) as ONE
   * registration epoch. `register()` alone chains only its own body onto
   * the epoch, so between `unregisterAll()` and the `register()` call the
   * runtime's map is empty while the epoch marker has already resolved —
   * any `processOrbitalEvent` that lands in that gap (the resolve of a big
   * organism takes real time) 404s `Orbital not found` even though the
   * requested orbital is milliseconds away from landing. Inside this
   * bracket the epoch stays pending for the WHOLE callback, so mid-swap
   * dispatches await the completed swap and then resolve against the new
   * app. A failed callback still releases the epoch (chained on both
   * branches), so a failed swap falls through to the honest 404 instead of
   * wedging the queue. Callbacks SERIALIZE: each bracket awaits the previous
   * epoch before running `fn`, so two hosts swapping at once (a catalog
   * select racing a preview remount's `/register`) cannot interleave their
   * unregister/register sequences into a mixed registry. A bracket opened
   * from INSIDE another bracket's callback runs `fn` directly — detected
   * via the AsyncLocalStorage context below (a depth counter alone can't
   * tell a true nest from a concurrent caller) — because the outer
   * callback's awaits already serialize it and queueing on the outer gate
   * would deadlock. Deadlock-free otherwise: `doRegister` never dispatches
   * events, so awaiting dispatches never block registration progress.
   */
  /**
   * Reentrancy context for `withRegistrationMutation`. A depth counter alone
   * cannot distinguish "called from inside a bracket callback" (must run
   * directly — queueing on the outer gate would deadlock) from "called
   * concurrently while another bracket is in flight" (must queue — running
   * directly would interleave two swaps). The ALS marks the callback's async
   * context, which separates the two exactly.
   */
  bracketAls = null;
  ensureBracketAls() {
    this.bracketAls ??= import('async_hooks').then(
      ({ AsyncLocalStorage }) => new AsyncLocalStorage()
    );
    return this.bracketAls;
  }
  async withRegistrationMutation(fn) {
    const previous = this.registrationEpoch ?? Promise.resolve();
    let release = () => void 0;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    this.registrationEpoch = previous.then(() => gate, () => gate);
    this.registrationMutationDepth++;
    try {
      const als = await this.ensureBracketAls();
      if (als.getStore() !== void 0) {
        release();
        return await fn();
      }
      await previous.catch(() => void 0);
      const nestingToken = /* @__PURE__ */ Symbol("withRegistrationMutation");
      return await als.run(nestingToken, fn);
    } finally {
      this.registrationMutationDepth--;
      release();
    }
  }
  /**
   * Reset the mock persistence store to a clean-slate re-seed without
   * unregistering orbitals. Exposed for verifier tools that want to
   * start each test with deterministic seeded rows, not the residue of
   * the previous walk's persist-creates. No-op when the runtime does not
   * seed a mock store of its own.
   */
  resetMockPersistence() {
    const store = this.ownedStore;
    if (!this.seedsMock() || store === void 0) return Promise.resolve();
    busLog.debug("mock:reset:enter", {
      orbitalCount: this.orbitals.size,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return this.enqueueStoreOp(async () => {
      store.clear();
      if (this.seededProgram !== void 0) await this.seedStores(this.seededProgram);
    });
  }
  /**
   * Return every registered orbital's circuit to boot: trait states to their
   * initial states, frames and row cache emptied, and a fresh mount (no trait
   * awaiting INIT, nothing held). The hermetic-reset twin of
   * `resetMockPersistence`: a reset walk must not inherit the previous walk's
   * circuit any more than its rows.
   */
  resetCircuitState() {
    this.inFlightCalls.cancelAll();
    this.kernelEngine?.reset();
    this.seedKernelRuntimeMock();
    this.kernelOs?.close();
  }
  /**
   * Wire a live-broadcast sink. Called only from a `persist` effect's
   * `emit:{success}` envelope firing site (batch and single-op) — see
   * `docs/Almadar_Live_Push.md`. The hosting server (e.g. the playground's
   * `/api/events` SSE endpoint) uses this to fan persist mutations out to
   * every OTHER connected client; a fresh call replaces the previous sink.
   */
  setLiveBroadcastSink(sink) {
    this.liveBroadcastSink = sink;
  }
  publishLiveItem(item) {
    this.liveBroadcastSink?.(item);
    for (const receive of this.liveSubscribers) receive(item);
  }
  /** Wire where a host-run dispatch's result goes (see `HostDispatchItem`); a fresh call replaces the previous sink. */
  setHostDispatchSink(sink) {
    this.hostDispatchSink = sink;
  }
  /** Run a follow-on step's call outcome as its own dispatch, and hand its result to the host-dispatch sink. */
  runDeferredOutcome(orbitalName, request) {
    void this.processOrbitalEvent(orbitalName, request).then(
      (response) => this.hostDispatchSink?.({ orbitalName, request, response, ...request.clientId !== void 0 ? { originClientId: request.clientId } : {} }),
      (error) => effectLog.error("deferred-outcome:failed", { orbitalName, event: request.event, trait: request.targetTrait, error: error.message })
    );
  }
  /**
   * Switch the viewer a dev host presents the app as — see
   * `OrbitalServerRuntimeConfig.defaultUser`. Pass `undefined` for an
   * unauthenticated viewer. Takes effect on the next event; an authenticated
   * request still overrides it.
   *
   * Mock mode stamps the seeded owner columns for whichever id was `defaultUser`
   * at register time. Switching to a different id re-points those cells with
   * `restampMockOwner` instead of re-seeding, so an ownership-scoped view for
   * the new viewer has rows. The returned promise settles when the restamp has
   * landed (immediately when there is nothing seeded yet; register flushes it).
   */
  setDefaultUser(user) {
    const previousId = this.config.defaultUser?.id;
    this.config.defaultUser = user;
    this.viewerNamedByHost = true;
    if (this.seedsMock() && user?.id !== void 0 && user.id !== previousId) return this.restampOwnerGated(user);
    return Promise.resolve();
  }
  /** Whether the host named the viewer (constructor or `setDefaultUser`). If not, the viewer is
   *  the app's first declared persona, resolved as soon as its roster is seeded. */
  viewerNamedByHost = false;
  /** setDefaultUser can land before register() finishes resolving the schema
   *  (a dev host pins a persona right after boot). An ungated restamp there
   *  would hand a read-only persona authorship of drafts, so the restamp is
   *  DEFERRED until the schema exists — register()/registerSync() flush it. */
  pendingOwnerRestamp = false;
  /**
   * Re-point the seeded owner cells at `user` (a persona switch never reseeds). The seed program's policy gates decide
   * per row whether the persona could have created it. Deferred when the program is not seeded yet.
   */
  restampOwnerGated(user) {
    if (this.seededProgram === void 0) {
      this.pendingOwnerRestamp = true;
      return Promise.resolve();
    }
    return this.enqueueStoreOp(async () => {
      const program = this.seededProgram;
      const journal = this.mockJournal;
      if (program === void 0 || journal === void 0) return;
      this.mockJournal = await this.withSeeder(user, (host) => restampMockOwner(host, program, journal, user));
    });
  }
  /** Flush a persona switch that arrived before the schema was resolved. */
  async flushPendingOwnerRestamp() {
    if (!this.pendingOwnerRestamp) return;
    this.pendingOwnerRestamp = false;
    const user = this.config.defaultUser;
    if (user?.id !== void 0) await this.restampOwnerGated(user);
  }
  /** The viewer a dev host is currently presenting the app as. */
  getDefaultUser() {
    return this.config.defaultUser;
  }
  /**
   * Queue a tick-stamped dispatch for coalesced snapshot relay (T6). Newest
   * per (originClientId, orbital, event) wins between flushes — the standard
   * netcode position-broadcast discipline.
   */
  queueTickRelay(orbitalName, request) {
    const key = `${request.clientId ?? ""}:${orbitalName}:${request.event}`;
    this.tickRelayPending.set(key, {
      event: request.event,
      payload: request.payload,
      source: { orbital: orbitalName, trait: request.sourceTrait, tick: request.tick },
      originClientId: request.clientId,
      target: "peers"
    });
    if (this.tickRelayTimer === null) {
      const timer = setInterval(() => this.flushTickRelay(), this.config.tickRelayIntervalMs ?? 50);
      if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
      this.tickRelayTimer = timer;
    }
  }
  flushTickRelay() {
    if (this.tickRelayPending.size === 0) {
      if (this.tickRelayTimer !== null) {
        clearInterval(this.tickRelayTimer);
        this.tickRelayTimer = null;
      }
      return;
    }
    const items = Array.from(this.tickRelayPending.values());
    this.tickRelayPending.clear();
    for (const item of items) this.publishLiveItem(item);
  }
  /**
   * The registered app's declared persona roster: the live rows of its
   * `[identity]` entity, mapped onto viewers (`Almadar_LOLO_Identity.md` §4.3).
   * Live-store rows rather than a re-derivation, so the roster carries the ids
   * ownership scoping actually compares `@user.id` against. Empty when no
   * schema is registered or the app declares no `[identity]` entity — there is
   * no global fallback roster by design.
   */
  /**
   * `reference` resolved for `user` against the store as it is now: the rows that still match its query and the
   * viewer's `@read`, in the reference's order, `total` re-counted. The kernel resolves through its server
   * resolve flight. A client reaches it with
   * `POST /:orbital/../resolve-rows` as the signed-in viewer.
   */
  async resolveRows(reference, user) {
    const schema = this.resolvedSchema;
    const owner = schema === null ? void 0 : entityOwnerOrbital(schema, reference.entityType);
    if (schema === null || owner === void 0) throw new Error(`${reference.entityType}: no registered orbital declares this entity`);
    return this.requireKernelEngine().resolveRows(reference, { orbital: owner.name, user });
  }
  async getIdentityRoster() {
    const schema = this.resolvedSchema;
    if (!schema) return [];
    const entityName = identityEntityName(schema);
    if (!entityName) return [];
    const rows = await this.persistence.list(entityName);
    return rows.map((row) => personaFromIdentityRow(row)).filter((p) => p !== void 0);
  }
  // ==========================================================================
  // Event Processing
  // ==========================================================================
  /**
   * Process an event for an orbital — the stateful host's thin shell over
   * the unified `evaluateOrbitalEvent` composition (design:
   * docs/Almadar_Runtime_Stateless_Stateful_PLAN.md §4.1). This method owns
   * ONLY session concerns: orbital lookup, viewer normalization, the lazy
   * OS/substrate handler wiring, the per-request relay mask
   * (G-RUNTIME-031 — the client's mounted set as DATA, replacing the
   * deleted blanket `originClientId` skip), the tick snapshot relay, and
   * the cross-orbital listens relay (a listener registered under a
   * DIFFERENT orbital than the emitter — the per-orbital composition's
   * in-band fan-out covers the rest). Target resolution, payload
   * validation, the cascade, the fan-out, structured rejections, and
   * response assembly are the composition's, identical to the stateless
   * path.
   *
   * Serialization: the whole evaluation runs on ONE runtime-wide async
   * queue. The composition commits manager state directly (no per-trait
   * actor queue), so concurrent requests against the long-lived session
   * manager would otherwise both evaluate from the same held state and
   * lose a transition. Coarser than the old per-(trait, entityId) actor
   * queues — a deliberate W4 tradeoff, recorded in the plan doc.
   *
   * @param onPush - Optional incremental-push callback. Called immediately
   * when an event is emitted or a client effect fires, before the promise
   * resolves. Used by the SSE streaming path to write items to the
   * response as they arrive rather than buffering and flushing at the end.
   */
  /**
   * Read an orbital by name, awaiting an in-flight registration mutation
   * first when the lookup misses (G-RUNTIME-038): mid-swap lookups 404ed
   * against the emptied map even though the requested orbital was
   * milliseconds from landing. A failed mutation falls through to the miss.
   */
  async resolveRegisteredOrbital(orbitalName) {
    let registered = this.orbitals.get(orbitalName);
    if (!registered && this.registrationEpoch !== null) {
      await this.registrationEpoch.catch(() => void 0);
      registered = this.orbitals.get(orbitalName);
    }
    return registered;
  }
  /** The registered orbitals as `GET /` lists them. */
  listOrbitalSummaries() {
    return Array.from(this.orbitals.entries()).map(([name, reg]) => ({
      name,
      entity: reg.entity?.name,
      traits: (reg.traits || []).map((t) => t.name)
    }));
  }
  /** One orbital as `GET /:orbital` describes it, awaiting an in-flight swap first (G-RUNTIME-038); `undefined` when it is not registered. */
  async describeOrbital(orbitalName) {
    const registered = await this.resolveRegisteredOrbital(orbitalName);
    if (!registered) return void 0;
    const states = {};
    for (const trait of registered.traits) {
      const currentState = this.kernelEngine?.stateOf(trait.name) ?? "";
      if (currentState !== "") states[trait.name] = currentState;
    }
    return {
      name: orbitalName,
      entity: registered.entity,
      traits: registered.traits.map((t) => ({
        name: t.name,
        currentState: states[t.name],
        states: (t.stateMachine?.states || []).map((s) => s.name),
        events: [...new Set((t.stateMachine?.transitions || []).map((tr) => tr.event))]
      }))
    };
  }
  /** An entity's full row set as `GET /:orbital/entities/:entityType` answers it (verification and tooling only); `undefined` when the orbital is not registered. */
  async entityRows(orbitalName, entityType) {
    const registered = await this.resolveRegisteredOrbital(orbitalName);
    if (!registered) return void 0;
    return this.persistence.list(entityType);
  }
  /** The program's declared external inputs: what an outside client may send which trait. */
  listExternalInputs() {
    return this.resolvedSchema ? externalInputsOf(this.resolvedSchema) : [];
  }
  /**
   * The outside-client input channel: an API caller, an agent acting as the
   * user, an MCP client. Only a declared external input of the target trait is
   * dispatched — through `processOrbitalEvent`, so guards, entity policies and
   * cascades apply exactly as for a click. Anything else is refused with
   * `not-an-external-input`. The app's own UI keeps using `processOrbitalEvent`.
   */
  /**
   * The running app lent to one `call-service` provider as the caller: the
   * declared inputs, the input channel as `user`, and the rows `user` may read
   * (the entity's `@read` policy, the same rule a `fetch` effect applies).
   */
  servicePorts(caller, user, message = () => {
  }, assertReentry) {
    return {
      caller,
      message,
      inputs: () => this.listExternalInputs(),
      readableEntities: () => this.resolvedSchema ? readableEntitiesOf(this.resolvedSchema) : [],
      dispatchInput: (orbital, request) => {
        assertReentry?.();
        return this.dispatchExternalInput(orbital, { ...request, ...user !== void 0 ? { user } : {} });
      },
      read: async (entity) => {
        const readPolicy = this.resolvedSchema ? entityAccessPolicies(this.resolvedSchema, entity)?.read : void 0;
        return applyRowAccess(await this.persistence.list(entity), readPolicy, void 0, { user });
      },
      supportsDispatchStream: true,
      dispatchRequest: (orbital, request, input, stream) => {
        assertReentry?.();
        return this.dispatchEventRequest(orbital, request, input, user, stream);
      },
      deliverInbound: (name, delivery) => this.deliverInbound(name, delivery)
    };
  }
  /**
   * A `program/dispatch` event request, as the events route (or with `input`, the inputs route) runs it: the
   * request's own `user` is its viewer, else the caller's. An unknown orbital is `ORBITAL_NOT_FOUND`, an undeclared
   * locale `LOCALE_NOT_DECLARED`; an inbound-only event and an undeclared input are the routes' refusals.
   */
  async dispatchEventRequest(orbital, request, input, caller, stream = false) {
    const streamItems = [];
    const onPush = stream ? (item) => {
      streamItems.push({ ...item, timestamp: item.timestamp ?? Date.now() });
    } : void 0;
    const answer = (response) => ({
      ok: true,
      response,
      ...stream ? { streamItems: [...streamItems, { type: "complete", data: response, timestamp: Date.now() }] } : {}
    });
    if (await this.describeOrbital(orbital) === void 0) {
      return { ok: false, error: `Orbital not found: ${orbital}`, code: "ORBITAL_NOT_FOUND", status: 404 };
    }
    const user = request.user ?? caller;
    if (input) {
      if (request.targetTrait === void 0) {
        return { ok: false, error: "program/dispatch: an input request names its trait", code: "NO_TRAIT", status: 400 };
      }
      const response = await this.dispatchExternalInput(orbital, {
        targetTrait: request.targetTrait,
        event: request.event,
        ...request.payload !== void 0 ? { payload: request.payload } : {},
        ...request.entityId !== void 0 ? { entityId: request.entityId } : {},
        ...user !== void 0 ? { user } : {}
      }, onPush);
      return answer(response);
    }
    const refusal = this.refuseInboundOnly(orbital, request);
    if (refusal !== void 0) return answer(refusal);
    if (request.locale !== void 0 && this.appLocales.length > 0 && !this.appLocales.includes(request.locale)) {
      const error = `locale "${request.locale}" is not one of the program's declared locales [${this.appLocales.join(", ")}]`;
      return { ok: false, error, code: "LOCALE_NOT_DECLARED", status: 400 };
    }
    return answer(await this.processOrbitalEvent(orbital, user !== void 0 ? { ...request, user } : request, onPush));
  }
  async dispatchExternalInput(orbitalName, request, onPush) {
    return dispatchDeclaredInput(this.resolvedSchema, orbitalName, request, (orbital, req) => this.processOrbitalEvent(orbital, req, onPush));
  }
  /**
   * An inbound delivery (`/api/hooks/<name>`): the runtime decides whether the name is served, runs
   * the handler through `processOrbitalEvent` and answers; the host only carries the bytes.
   */
  /**
   * An event that is an inbound hook's is delivered only by `deliverInbound`: the app's own event
   * route refuses it, as the input channel refuses an event that is no declared input.
   */
  refuseInboundOnly(orbitalName, request) {
    const trait = this.resolvedSchema ? inboundOnlyTrait(this.resolvedSchema, orbitalName, request.targetTrait, request.event) : void 0;
    if (trait === void 0) return void 0;
    return {
      success: false,
      transitioned: false,
      states: {},
      emittedEvents: [],
      error: inboundOnlyMessage(trait, request.event),
      rejections: [{ code: "inbound-only-event", trait, event: request.event }]
    };
  }
  async deliverInbound(name, delivery, onPush) {
    return dispatchInbound(this.resolvedSchema, name, delivery, (orbital, req) => this.processOrbitalEvent(orbital, req, onPush), (credential) => (this.httpPorts()?.secrets ?? createHttpSecrets()).get(credential, void 0));
  }
  async processOrbitalEvent(orbitalName, request, onPush) {
    try {
      await this.ensureProgramHandlers();
      const registered = await this.resolveRegisteredOrbital(orbitalName);
      if (!registered) {
        return {
          success: false,
          transitioned: false,
          states: {},
          emittedEvents: [],
          error: `Orbital not found: ${orbitalName}`
        };
      }
      if (request.event === UNMOUNT_EVENT) {
        this.recordMount(orbitalName, request, false);
        return { success: true, transitioned: false, states: {}, emittedEvents: [] };
      }
      if (request.mount !== void 0 || LIFECYCLE_EVENTS.includes(request.event)) {
        this.recordMount(orbitalName, request, true);
      }
      const response = await this.enqueueEvent(
        (queueHold) => this.evaluateForOrbital(registered, request, onPush, queueHold)
      );
      if (request.tick !== void 0 && this.liveBroadcastSink !== null) {
        this.queueTickRelay(orbitalName, request);
      }
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      xOrbitalLog.error("processOrbitalEvent:error", {
        orbital: orbitalName,
        event: request.event,
        entityId: request.entityId,
        error: message
      });
      return {
        success: false,
        transitioned: false,
        states: {},
        emittedEvents: [],
        error: message
      };
    }
  }
  /**
   * The enqueued critical section behind `processOrbitalEvent`: evaluate
   * one request through the composition, then relay its emits to
   * cross-orbital listeners. MUST only run holding the event queue.
   */
  async evaluateForOrbital(registered, request, onPush, queueHold) {
    const orbitalName = registered.schema.name;
    const payloadRow = request.payload?.["row"];
    const payloadRowAsPayload = payloadRow !== null && typeof payloadRow === "object" && !Array.isArray(payloadRow) ? payloadRow : void 0;
    const payloadRowId = payloadRowAsPayload?.["id"];
    renderLog.debug("processOrbitalEvent:enter", {
      orbital: orbitalName,
      event: request.event,
      hasPayloadRow: payloadRowAsPayload !== void 0,
      payloadRowId: typeof payloadRowId === "string" || typeof payloadRowId === "number" ? payloadRowId : void 0,
      entityId: request.entityId
    });
    busLog.debug("bus:incoming", () => ({
      orbital: orbitalName,
      event: request.event,
      payload: JSON.stringify(request.payload ?? null),
      entityId: request.entityId,
      traitStates: JSON.stringify(registered.traits.map((trait) => ({ traitName: trait.name, currentState: this.kernelEngine?.stateOf(trait.name) ?? "" })))
    }));
    xOrbitalLog.info("processOrbitalEvent:enter", () => ({
      orbital: orbitalName,
      event: request.event,
      traitsInOrbital: registered.traits.map((t) => t.name).join(","),
      payloadActiveTraits: JSON.stringify(
        request.payload?.["_activeTraits"] ?? null
      )
    }));
    const viewer = normalizeUserContext(request.user) ?? this.config.defaultUser;
    if (request.locale !== void 0 && this.appLocales.length > 0 && !this.appLocales.includes(request.locale)) {
      throw new Error(`locale "${request.locale}" is not one of the program's declared locales [${this.appLocales.join(", ")}]`);
    }
    const isDelegatedLeg = (request.targetTrait !== void 0 || request.mount !== void 0) && (request.traits !== void 0 || request.entityByTrait !== void 0);
    let serverRequest = request;
    if (!isDelegatedLeg && request.targetTrait === void 0) {
      const sidecarTarget = request.payload?.["_targetTrait"];
      if (sidecarTarget !== void 0 || request.traits !== void 0 || request.entityByTrait !== void 0) {
        serverRequest = { ...request, ...sidecarTarget !== void 0 ? { targetTrait: sidecarTarget } : {} };
        delete serverRequest.traits;
        delete serverRequest.entityByTrait;
      }
    }
    const response = await evaluateOnKernel(
      { engine: this.requireKernelEngine(), orbital: registered.schema.name, ...onPush !== void 0 ? { onStream: (item) => {
        if (item.type === "event" || item.type === "effect") onPush(item);
      } } : {}, outsideEventQueue: (work) => this.outsideEventQueue(queueHold, work) },
      serverRequest,
      viewer,
      request.locale
    );
    this.publishKernelResponse(response, void 0, request.clientId);
    return response;
  }
  /**
   * Feed the host sinks from a kernel response: the kernel answers a dispatch whole, so each emit reaches the
   * event bus (the public firehose) and `onPush` once the dispatch is done, in the order the response carries them.
   */
  publishKernelResponse(response, onPush, originClientId) {
    for (const hop of response.transitions ?? []) {
      this.transitionFanout.onTransition({ traitName: hop.trait, from: hop.from, to: hop.to, event: hop.event, ...hop.firedArm !== void 0 ? { firedArm: hop.firedArm } : {}, ...hop.guardResult !== void 0 ? { guardResult: hop.guardResult } : {}, effects: hop.effects });
    }
    for (const emitted of response.emittedEvents) {
      this.eventBus.emit(emitted.event, emitted.payload, emitted.source, eventRouteKey(emitted.event, emitted.source?.eventId));
      if (emitted.source?.persistSuccess === true) {
        const { persistSuccess: _mark, ...source } = emitted.source;
        this.publishLiveItem({ event: emitted.event, ...emitted.payload !== void 0 ? { payload: emitted.payload } : {}, source, ...originClientId !== void 0 ? { originClientId } : {}, target: "peers" });
      }
      onPush?.({ type: "event", data: emitted });
    }
    for (const effect of response.clientEffects ?? []) onPush?.({ type: "effect", data: effect });
  }
  /**
   * The runtime-wide event queue — ONE async serialization point for every
   * composition run (requests, cross-orbital relays, external emits, tick
   * relays). The composition commits manager state directly rather than
   * through the manager's per-(trait, entityId) actor queues, so without
   * this, two concurrent requests against the session manager could both
   * evaluate from the same held state and lose a transition. `run` sees
   * the caller's result (or throw); the queue itself never wedges on a
   * failure.
   */
  eventQueue = Promise.resolve();
  /** This app's in-flight keyed `call-service`s, shared by every transition it runs (`cancel-call`). */
  inFlightCalls = new InFlightCalls();
  /** Wait for the queue, then hold it until the returned release is called. FIFO. */
  acquireEventQueue() {
    const previous = this.eventQueue;
    let release = () => void 0;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    this.eventQueue = previous.then(() => held);
    return previous.then(() => release);
  }
  /**
   * Hold the queue for `run`, handing it the hold so the work it reaches can
   * release it (`outsideEventQueue`). The hold is passed explicitly rather than
   * carried in async context: this runtime also runs in the browser (the orb
   * website), which has no AsyncLocalStorage.
   */
  async enqueueEvent(run) {
    const hold = { held: true, release: await this.acquireEventQueue() };
    try {
      return await run(hold);
    } finally {
      if (hold.held) hold.release();
    }
  }
  /**
   * Run `work` with this context's queue hold released, then re-acquire it (in
   * FIFO order behind whatever queued meanwhile). Dispatches that land while
   * released run as their own dispatches; their commits and the held run's
   * later commit follow server-arrival last-write-wins. Outside a hold, `work`
   * just runs.
   */
  async outsideEventQueue(hold, work) {
    if (hold === void 0 || !hold.held) return work();
    hold.held = false;
    hold.release();
    try {
      return await work();
    } finally {
      hold.release = await this.acquireEventQueue();
      hold.held = true;
    }
  }
  // ==========================================================================
  // Direct API (for programmatic use)
  // ==========================================================================
  /**
   * Get the event bus for manual event emission
   */
  getEventBus() {
    return this.eventBus;
  }
  /** Observe every executed hop (listener deliveries included) on every orbital; returns the unsubscribe. */
  observeTransitions(observer) {
    this.transitionObservers.add(observer);
    return () => {
      this.transitionObservers.delete(observer);
    };
  }
  /**
   * Get state for a specific orbital/trait
   */
  getState(orbitalName, traitName) {
    const registered = this.orbitals.get(orbitalName);
    if (!registered) return void 0;
    const kernel = this.kernelEngine;
    if (kernel === null) return void 0;
    const stateOf = (name) => {
      const currentState = kernel.stateOf(name);
      return currentState === "" ? void 0 : { traitName: name, currentState, previousState: null, lastEvent: null, context: {} };
    };
    if (traitName) return stateOf(traitName);
    const states = {};
    for (const trait of registered.traits) {
      const state = stateOf(trait.name);
      if (state !== void 0) states[trait.name] = state;
    }
    return states;
  }
  /**
   * List registered orbitals
   */
  listOrbitals() {
    return Array.from(this.orbitals.keys());
  }
  /**
   * Check if an orbital is registered
   */
  hasOrbital(name) {
    return this.orbitals.has(name);
  }
  /**
   * Get information about active ticks
   */
  getActiveTicks() {
    return this.tickBindings.map((binding) => ({
      orbital: binding.orbitalName,
      trait: binding.traitName,
      tick: binding.tick.name,
      interval: binding.tick.interval,
      hasGuard: !!binding.tick.guard
    }));
  }
  /** Halt every registered tick's shared clock. Delegates to `TickScheduler.pause`. */
  pauseTicks() {
    this.tickScheduler.pause();
  }
  /** Resume ticks halted by `pauseTicks()`. Delegates to `TickScheduler.resume`. */
  resumeTicks() {
    this.tickScheduler.resume();
  }
  /** True while ticks are paused. Delegates to `TickScheduler.isPaused`. */
  areTicksPaused() {
    return this.tickScheduler.isPaused;
  }
};
function createOrbitalServerRuntime(config) {
  return new OrbitalServerRuntime(config);
}

export { OrbitalServerRuntime, UnresolvedProgramError, createOrbitalServerRuntime };
