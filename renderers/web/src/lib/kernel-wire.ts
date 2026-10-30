/**
 * The `Kernel` class surface of `@almadar/kernel` (JSON strings in, JSON strings out). The wire data it
 * speaks (`DispatchWire`, `AppliedWire`, `FrameWire`, ...) is imported from `@almadar/core/kernel-wire`.
 *
 * @packageDocumentation
 */

import type { KernelModule as RuntimeKernelModule } from '../index';

/** The `Kernel` class `@almadar/kernel` exports: JSON strings in, JSON strings out. */
export interface KernelInstance {
  dispatch(traitName: string, entityId: string | undefined, event: string, payloadJson?: string): string;
  /** A flight for work the kernel did not wire (a dispatch the host ran on its own, a frame's browser leg). */
  openFlight(): number;
  /** `applyServerResponse` in flight order (EXEC-CONC-8): a `FoldProgressWire` as JSON, folded now or queued behind an older flight. */
  foldInOrder(flight: number, responseJson: string, alreadyDeliveredJson?: string, baseJson?: string): string;
  /** `foldInOrder` for an emit that entered from outside the kernel (another client's push): delivered to its declared listeners only, a `FoldProgressWire` as JSON. */
  deliverEmitToListeners(flight: number, emittedJson: string): string;
  /** `deliverEmitToListeners` for a live message of this client's own running call, whose emitter ran its own arm as that call's progress dispatch: the emitter is not delivered its own emit a second time. */
  deliverOriginEmit(flight: number, emittedJson: string): string;
  /** The oldest queued answer that can fold now, folded: a `FoldedNextWire` as JSON, or `undefined` when none waits. */
  nextFold(): string | undefined;
  /** The flight is done: its answers are folded, or the host gave up on them. */
  endFlight(flight: number): boolean;
  /** The rows a posted leg's answer is folded against; `undefined` when the leg carried none. */
  /** The leg as a host that holds the circuit state takes it: only the `[shared]` frame rows its traits read. */
  statefulLeg(legJson: string): string;
  /** The mount a reconnecting client posts to rebuild its session: the seeds with the state and frame this client holds for each. */
  reseedLeg(seedsJson: string, entityId?: string): string;
  foldBase(carriedJson: string | undefined, seededJson: string, entityId?: string): string | undefined;
  dispatchMount(seedsJson: string, entityId?: string, payloadJson?: string): string;
  /** The frame delta a painter at version `since` of this kernel's frames needs (`FrameDelta` JSON): empty when current, else a snapshot. */
  framesSince(since: number): string;
  restore(traitName: string, entityId: string | undefined, snapshotJson: string): string;
  tick(traitName: string, tickName: string, entityId?: string): string;
  frame(nowMs: number): string | undefined;
  framePause(): void;
  frameResume(): void;
  tickCount(): number;
  /** The kernel's dispatch mode for a registered trait (`DispatchMode` as JSON text); throws for an unregistered one. */
  dispatchMode(traitName: string): string;
  /** The config the kernel binds as `@config` for a registered trait (JSON text); throws for an unregistered one. */
  traitConfig(traitName: string): string;
  getState(traitName: string, entityId?: string): string;
  setCurrentUser(userJson: string): void;
  /** The viewer's locales (`string[]`, the first is painted) and their catalogs (`{ [locale]: { [key]: text } }`) for `i18n/t`. */
  setMessages(localesJson: string, catalogsJson: string): void;
  /** The host runs the listeners of every emit it marks `dispatched` (the JS runtime, `orbital-server`). */
  setHostFansOut(fansOut: boolean): void;
  /** Carry each hop's `@entity` before and after it on the dispatch's transitions, for a verifier (EXEC-STEP-10). */
  setRecordEntityAfter(record: boolean): void;
  /** Carry each frame response's `effectResults` (omitted otherwise), for a verifier. */
  setFrameEffectResults(carry: boolean): void;
  /** The kernel's mounts for a host start on `side` (`client|server|process|start`): `MountSeed[]` as JSON. */
  bootMounts(side: string): string;
  /** The kernel's mounts for a client opening `routePath`: `MountSeed[]` as JSON. */
  routeMounts(routePath: string): string;
  /** The circuit a client mounts for `page` or `route` (neither: the initial page): a `PageCircuit` as JSON. */
  pageCircuit(page?: string, route?: string): string;
  /** One question about the registered program (a `ContractQuery` as JSON): its answer as JSON. */
  contractQuery(queryJson: string): string;
  mount(traitsJson: string): void;
  /** The page `mountKey` holds `traitsJson`, opened at `routePath` when it has one: an `Entered` as JSON (the seeds to mount, the traits that left with the legs that release them). */
  enter(routePath: string | undefined, mountKey: string, traitsJson: string): string;
  /** Every trait the page entered leaves: `Left[]` as JSON. */
  leave(): string;
  /** The host's report of whether a trait's rendered output is on screen; gates its `[visible]` ticks. */
  setTraitOnScreen(traitName: string, onScreen: boolean): void;
  seed(entityType: string, rowsJson: string): void;
  free(): void;
}

/**
 * What a host's loader resolves: the `@almadar/kernel` module with its WebAssembly already
 * initialised and its language installed (`loadBrowserKernel` in a browser, `initSync` in Node). `@almadar/ui` never imports the
 * package itself, so the default bundle carries none of it.
 */
export interface KernelModule extends RuntimeKernelModule {
  Kernel: new (resolvedSchemaJson: string, clientId: string) => KernelInstance;
}

export type KernelLoader = () => Promise<KernelModule>;


