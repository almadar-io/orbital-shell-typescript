import type { KernelEvaluatorExports } from '@almadar/core';
import type { EventRequest, FrameWire } from '@almadar/core/kernel-wire';

/** Fired ticks keyed by the orbital that declares them: the one a `runTick` request is addressed to. */
export type FiredByOrbital = FrameWire['fired'];

/**
 * The server-role kernel's wire is `@almadar/core/kernel-wire` (generated from orbital-core `embed::wire`);
 * re-exported here for the kernel module's callers. Only the `Server` class surface lives in this file.
 */
export type {
  CallerWire,
  CallRoutesWire,
  CallSiteWire,
  IoAnswerWire,
  IoReplyWire,
  IoRequestWire,
  NextWire,
  PendingRequestWire,
  ResolveProgressWire,
  ServerProgressWire,
  Settled,
  SubstrateFailureWire,
} from '@almadar/core/kernel-wire';

/** The `Server` class of `@almadar/kernel` (wasm-bindgen), as the runtime uses it. */
export interface KernelServerHandle {
  start(orbital: string, requestJson: string): string;
  resume(flight: number, repliesJson: string): string;
  /** The oldest request the kernel queued, started now the lane is free: a `NextWire` as JSON, or `null`. */
  next(): string;
  /** Whether `flight` is a dispatch parked holding the lane. */
  holdsLane(flight: number): boolean;
  /** A live stream of `client`'s session opened (EXEC-DIST-9); answers the id that closes it. */
  openSessionStream(client: string): number;
  /** The live stream `id` dropped; the kernel frees its session once all have dropped and it is quiet. */
  closeSessionStream(id: number): boolean;
  dispatchStream(): string;
  liveItemDelivered(itemJson: string, viewerJson: string, clientId?: string): boolean;
  /** A row-set reference resolved for a viewer through the host-answered store; a `ResolveProgressWire` as JSON. */
  resolveRows(refJson: string, viewerJson: string): string;
  resumeResolve(flight: number, repliesJson: string): string;
  abandon(flight: number): boolean;
  /** `OsGrants::allows` over the grants the registered program declares; `requirementJson` is an `OsRequirement`. */
  osAllows(requirementJson: string): boolean;
  /** Place the program's anchored grants and arguments under the host's anchors; answers `[{ path, message }]` for what grants nothing. */
  setOsAnchors(anchorsJson: string): string;
  /** Feed a deferred raw `os` outcome (`Settled`) into the TLS operation parked under `key`: `null`, `{ ask }` or `{ done }`. */
  tlsComplete(key: string, outcomeJson: string): string;
  /** An `os/` call's arguments with its anchored parts resolved; a `Settled<args, OsError>` as JSON. */
  osResolveArgs(op: string, argsJson: string): string;
  inFlight(): number;
  getState(traitName: string, entityId?: string): string;
  setDefaultUser(userJson: string): void;
  /** The kernel's mounts for a host start on `side` (`client|server|process|start`): `MountSeed[]` as JSON. */
  bootMounts(side: string): string;
  /** The kernel's mounts for a client opening `routePath`: `MountSeed[]` as JSON. */
  routeMounts(routePath: string): string;
  /** One question about the registered program (a `ContractQuery`: the declared inputs, inbound hooks, entity owner, scoped rows): its answer as JSON. */
  contractQuery(queryJson: string): string;
  mount(traitsJson: string): void;
  remount(traitsJson: string): void;
  /** Whether the kernel holds the circuit state: a client's copy of it is then taken only on a delegated leg, and any other request carrying one is refused. */
  setStateful(stateful: boolean): void;
  /** `client` mounted the traits (`string[]` JSON) of `orbital`: their mount-scoped ticks fire while any client holds them. */
  mountClient(client: string, orbital: string, traitsJson: string): void;
  unmountClient(client: string, orbital: string, traitsJson: string): void;
  /** `client` is gone: everything it mounted is released. */
  releaseClient(client: string): void;
  /** Queue the tick-stamped request (an `EventRequest` as JSON) of `orbital` for the coalesced peer relay: the window length in ms as JSON when it opened one, else `null`. */
  relayTick(orbital: string, requestJson: string): string;
  setTickRelayInterval(intervalMs: number): void;
  /** Every queued relay item (`LiveBroadcastItem[]` as JSON); the window closes. */
  flushTickRelay(): string;
  /** Whether the program declares any tick. */
  declaresTicks(): boolean;
  /** One pass of the kernel's tick clock at monotonic `nowMs`: the `(trait, tick)` pairs due that this server runs, keyed by orbital, as `FiredByOrbital` JSON. */
  tickPass(nowMs: number): string;
  tickPause(): void;
  tickResume(): void;
  tickPaused(): boolean;
  setCapabilities(entityType: string, queryJson: string, writeJson: string): void;
  setMessages(localesJson: string, catalogsJson: string): void;
  /** The program (as JSON) whose declared credentials this server's credential effects manage beside its own. */
  setManagedProgram(programJson: string): void;
  lastError(): string;
  /** A server holding this one's registered program and none of its session (a stateless request's kernel). */
  fork(): KernelServerHandle;
  forkProgram(programJson: string): KernelServerHandle;
  free(): void;
}

/** The `Server` constructor of a kernel module. */
export interface KernelServerClass {
  /** `lazyDir`: the folder the program's `uses lazy` files sit beside; the kernel loads each on the first dispatch that reaches it (EXEC-LOAD-2). */
  new (resolvedSchemaJson: string, lazyDir?: string): KernelServerHandle;
}

/** An initialised `@almadar/kernel` module: what `OrbitalServerRuntime({ engine: 'kernel' })` is handed. */
export interface KernelModule extends KernelEvaluatorExports {
  Server: KernelServerClass;
  /** Whether the absolute `glob` matches `path`, as the one-grant matcher `os/glob` filters with. */
  osGlobMatches(glob: string, path: string): boolean;
  /** `is_public_address`: the rule an outbound host name must pass. */
  isPublicAddress(ip: string): boolean;
  /** One `ContractQuery` (as JSON) answered for a host with no registered program: the kernel's own answer on an empty kernel, as JSON. */
  contractQueryWithoutProgram(queryJson: string): string;
  /** The `os/` operations whose keyed call may defer its completion (`OsOp::defers_completion`), as a JSON array of names. */
  osDeferringOps(): string;
  /** The `os/` operations whose keyed call is a stream (`OsOp::is_stream`), as a JSON array of names. */
  osStreamOps(): string;
  /** The `{ event, payload }` JSON a deferred keyed `os/` call's outcome fires on its call site, or `null` when it declares no route. */
  osCompletionEvent(siteJson: string, key: string, outcomeJson: string): string;
  substrateCompletionEvent(siteJson: string, key: string, op: string, argsJson: string, outcomeJson: string): string;
  /** Whether the Chrome match pattern matches the URL: the one rule a browser-tab host filters tabs with. */
  tabUrlMatches(pattern: string, url: string): boolean;
  /** The typed event request a `program/dispatch` call names (`EventRequest::from_dispatch`); a record that is no event request throws the reason. */
  parseEventRequest(payloadJson: string, optionsJson: string): EventRequest;
  /** Installs the language data (`@almadar/core/language-data` `LanguageBundle` as JSON) for a host with no `node_modules`; the first install wins. */
  installLanguage(bundleJson: string): void;
}
