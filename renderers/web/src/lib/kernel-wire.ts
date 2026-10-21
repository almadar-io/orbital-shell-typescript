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
  applyServerResponse(responseJson: string, alreadyDeliveredJson?: string, baseJson?: string): string;
  /** The rows a posted leg's answer is folded against; `undefined` when the leg carried none. */
  /** The leg as a host that holds the circuit state takes it: only the `[shared]` frame rows its traits read. */
  statefulLeg(legJson: string): string;
  foldBase(carriedJson: string | undefined, seededJson: string, entityId?: string): string | undefined;
  dispatchMount(seedsJson: string, entityId?: string, payloadJson?: string): string;
  restore(traitName: string, entityId: string | undefined, snapshotJson: string): string;
  tick(traitName: string, tickName: string, entityId?: string): string;
  frame(nowMs: number): string | undefined;
  framePause(): void;
  frameResume(): void;
  tickCount(): number;
  getState(traitName: string, entityId?: string): string;
  setCurrentUser(userJson: string): void;
  /** The viewer's locales (`string[]`, the first is painted) and their catalogs (`{ [locale]: { [key]: text } }`) for `i18n/t`. */
  setMessages(localesJson: string, catalogsJson: string): void;
  /** The host runs the listeners of every emit it marks `dispatched` (the JS runtime, `orbital-server`). */
  setHostFansOut(fansOut: boolean): void;
  /** Carry each hop's `@entity` before and after it on the dispatch's transitions, for a verifier (EXEC-STEP-10). */
  setRecordEntityAfter(record: boolean): void;
  mount(traitsJson: string): void;
  remount(traitsJson: string): void;
  unmount(traitsJson: string): void;
  /** The host's report of whether a trait's rendered output is on screen; gates its `[visible]` ticks. */
  setTraitOnScreen(traitName: string, onScreen: boolean): void;
  seed(entityType: string, rowsJson: string): void;
  free(): void;
}

/**
 * What a host's loader resolves: the `@almadar/kernel` module with its WebAssembly already
 * initialised (`await init()` in a browser, `initSync` in Node). `@almadar/ui` never imports the
 * package itself, so the default bundle carries none of it.
 */
export interface KernelModule extends RuntimeKernelModule {
  Kernel: new (resolvedSchemaJson: string, clientId: string) => KernelInstance;
}

export type KernelLoader = () => Promise<KernelModule>;

/** Resolves the language bundle (`@almadar/core/language-data` `LanguageBundle`) as JSON text, for a kernel a browser opens over a local store. */
export type LanguageLoader = () => Promise<string>;
