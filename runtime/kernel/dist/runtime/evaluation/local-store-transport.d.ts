import { OrbitalSchema, PersistenceAdapter, OnDeviceModelPorts, BrowserTabPort, MessageCatalogs, UserContext, RowSetRef, RowQueryPage } from '@almadar/core';
import { EffectHandlers } from '../types.js';
import { KernelEngine } from '../../kernel/engine.js';
import { KernelHostPorts } from '../../kernel/host.js';
import { HttpPorts } from '../../kernel/http.js';
import { KernelModule } from '../../kernel/wire.js';
import { EventTransport } from '../../client/EventTransport.js';
import '../../service/default-call-service.js';
import '../../service/service-provider.js';
import '../../kernel/program-effects.js';
import '../effects/composition/compose-behaviors.js';
import '../effects/composition/event-wiring.js';
import '../effects/composition/layout-strategy.js';
import '../effects/composition/pipe.js';
import '../../effects/in-flight-calls.js';
import '../../kernel/beacon.js';
import '../../credentials/store.js';
import '../../kernel/decode.js';
import '@almadar/core/kernel-wire';
import '../../kernel/os-port.js';

/**
 * An in-process transport over a local store: every request runs on the kernel opened over that store
 * (`openLocalKernel`), and this host answers its I/O. The offline preview and the browser-stored side of a
 * residence-routed host both use it.
 */

interface LocalKernelOptions {
    /** The initialised `@almadar/kernel` module. */
    kernel: KernelModule;
    /** The language bundle as JSON (`LanguageBundle`), installed into `kernel` before it opens: a browser has no `node_modules` to read it from. */
    language: string;
    schema: OrbitalSchema;
    /** Every row the kernel reads and writes (`localStorePersistence` over a browser store). */
    persistence: PersistenceAdapter;
    /** Answers every `call-service`; absent, the default provider. */
    callService?: EffectHandlers['callService'];
    /** The running app lent to `call-service` providers; absent, a provider reads the rows its viewer may read and dispatches no input. */
    servicePorts?: KernelHostPorts['servicePorts'];
    /** Where a follow-on call's outcome is dispatched; absent, nowhere. */
    deferCallOutcome?: KernelHostPorts['deferCallOutcome'];
    pageFacts?: KernelHostPorts['pageFacts'];
    http?: HttpPorts;
    onDevice?: OnDeviceModelPorts;
    tabs?: BrowserTabPort;
    /** The program's message catalogs, so `i18n/t` resolves for the request's locale. */
    messages?: MessageCatalogs;
}
/** A local store's rows as the kernel holds them: browser-stored entities in `store`, every other entity in `memory` (a native `MemoryStore` adapter). */
declare function localStorePersistence(schema: OrbitalSchema, store: PersistenceAdapter, memory: PersistenceAdapter): PersistenceAdapter;
/** A kernel over a local store, answering its I/O with `persistence` and the given ports. */
declare function openLocalKernel(options: LocalKernelOptions): KernelEngine;
interface LocalStoreTransportOptions {
    /** The kernel the requests run on (`openLocalKernel`), or its promise while the kernel module loads. */
    kernelEngine: KernelEngine | Promise<KernelEngine>;
    /** The viewer every request runs as, or its promise while the host resolves it (a mock store's seeded persona). */
    user?: UserContext | Promise<UserContext | undefined>;
    /** Releases the host's request queue while a `call-service` awaits its provider. */
    outsideEventQueue?: <T>(work: () => Promise<T>) => Promise<T>;
    /** The program the kernel runs; given, the transport resolves row-set references on that kernel. */
    schema?: OrbitalSchema;
}
declare function createLocalStoreTransport(options: LocalStoreTransportOptions): EventTransport;
/** `reference` resolved on a local kernel for `user`: the kernel applies the viewer's `@read`, the host answers its row reads. */
declare function resolveLocalRows(engine: KernelEngine, schema: OrbitalSchema, user: UserContext | undefined, reference: RowSetRef): Promise<RowQueryPage>;

export { type LocalKernelOptions, type LocalStoreTransportOptions, createLocalStoreTransport, localStorePersistence, openLocalKernel, resolveLocalRows };
