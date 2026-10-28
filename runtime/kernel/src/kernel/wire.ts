import type { KernelEvaluatorExports } from '@almadar/core';
import type { EventRequest } from '@almadar/core/kernel-wire';

/**
 * The server-role kernel's wire is `@almadar/core/kernel-wire` (generated from orbital-core `embed::wire`);
 * re-exported here for the kernel module's callers. Only the `Server` class surface lives in this file.
 */
export type {
  CallerWire,
  CallRoutesWire,
  CallSiteWire,
  HttpBody,
  HttpFailureWire,
  HttpRequestWire,
  HttpResponseWire,
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
  /** An `os/` call's arguments with its anchored parts resolved; a `Settled<args, OsError>` as JSON. */
  osResolveArgs(op: string, argsJson: string): string;
  inFlight(): number;
  getState(traitName: string, entityId?: string): string;
  setDefaultUser(userJson: string): void;
  /** The kernel's mounts for a host start on `side` (`client|server|process|start`): `MountSeed[]` as JSON. */
  bootMounts(side: string): string;
  /** The kernel's mounts for a client opening `routePath`: `MountSeed[]` as JSON. */
  routeMounts(routePath: string): string;
  mount(traitsJson: string): void;
  remount(traitsJson: string): void;
  setTickMount(traitsJson: string): void;
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
  new (resolvedSchemaJson: string): KernelServerHandle;
}

/** An initialised `@almadar/kernel` module: what `OrbitalServerRuntime({ engine: 'kernel' })` is handed. */
export interface KernelModule extends KernelEvaluatorExports {
  Server: KernelServerClass;
  /** Whether the absolute `glob` matches `path`, as the one-grant matcher `os/glob` filters with. */
  osGlobMatches(glob: string, path: string): boolean;
  /** `is_public_address`: the rule an outbound host name must pass. */
  isPublicAddress(ip: string): boolean;
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
