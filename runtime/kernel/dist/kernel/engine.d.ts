import { OrbitalSchema, MessageCatalogs, RowSetRef, RowQueryPage, OrbitalEventRequest, OrbitalEventResponse, EventStreamItem, UserContext } from '@almadar/core';
import { KernelHostPorts, KernelAnswerScope } from './host.js';
import { KernelModule, KernelServerHandle } from './wire.js';
import '../effects/in-flight-calls.js';
import '../service/service-provider.js';
import './program-effects.js';
import './http.js';
import './beacon.js';
import '../credentials/store.js';
import './decode.js';
import '@almadar/core/kernel-wire';
import './os-port.js';

/**
 * The kernel-backed implementation of `evaluateOrbitalEvent` / `OrbitalServerRuntime`: the Rust kernel
 * (`@almadar/kernel`, WebAssembly) decides every execution step; this host answers the I/O it asks for
 * and nothing else. The continuation of a stopped dispatch never leaves the wasm instance.
 */

declare class KernelEngine {
    private readonly kernel;
    private readonly schemaJson;
    private readonly ports;
    private readonly entityTypes;
    private readonly store?;
    private readonly preserveProgramContext;
    private handle;
    private readonly lane;
    private tickMount;
    private messages;
    constructor(kernel: KernelModule, schemaJson: string, ports: KernelHostPorts, entityTypes?: readonly string[], store?: Readonly<Record<string, string>> | undefined, forkedFrom?: KernelServerHandle, providedHandle?: KernelServerHandle, preserveProgramContext?: boolean);
    /**
     * A kernel on the same program, registered once, holding none of this one's session: every trait at its initial
     * state, no rows the kernel held, its locales and mounted ticks kept. A stateless host serves each request a
     * fork (EXEC-DIST-5), `ports` answering it.
     */
    fork(ports?: KernelHostPorts): KernelEngine;
    forkProgram(program: OrbitalSchema, ports?: KernelHostPorts): KernelEngine;
    /** A server over the host's ports, or over the kernel's own store when `store` selects one (native add-on only). */
    private openServer;
    private declare;
    static open(kernel: KernelModule, schema: OrbitalSchema, ports: KernelHostPorts, store?: Readonly<Record<string, string>>): KernelEngine;
    /** A fresh kernel on the same program: every trait back at its initial state. */
    reset(): void;
    private managedProgram;
    /** The program whose declared credentials this kernel's credential effects manage beside its own (a console's app). */
    setManagedProgram(program: OrbitalSchema): void;
    /** The program's declared locales and merged catalogs (a lazy page's behavior contributes its namespaced keys). */
    setMessages(locales: readonly string[], catalogs: MessageCatalogs): void;
    /** The traits some client has mounted: a tick that is not `[background]` fires only for these. */
    setTickMount(traits: string[]): void;
    /** Mock-seed the `[runtime]` entities the kernel holds itself, owner columns stamped with `viewerId`. */
    seedRuntimeMock(viewerId: string | undefined): void;
    dispose(): void;
    liveItemDelivered(item: object, viewer: object | null, clientId?: string): boolean;
    /** `OsGrants::allows` over the grants of the program this kernel runs. */
    osAllows(requirementJson: string): boolean;
    /** Place the program's anchored grants and arguments under the host's anchors. */
    setOsAnchors(anchorsJson: string): string;
    /** An `os/` call's arguments with its anchored parts resolved under the host's anchors. */
    osResolveArgs(op: string, argsJson: string): string;
    /** The current state of a trait instance, `''` when it has none. */
    stateOf(traitName: string, entityId?: string): string;
    /**
     * `reference` resolved for `scope.user` against the host-answered store (EXEC-RENDER-3): the rows that still
     * match its query and the viewer's `@read` in the reference's order, a missing or hidden row omitted, and `total`
     * re-counted (a `total: none` reference is not re-counted: the total is the resolved window). Each read the
     * kernel makes is answered here, as in `evaluate`.
     */
    resolveRows(reference: RowSetRef, scope: KernelAnswerScope): Promise<RowQueryPage>;
    /** Run `request` against `orbital`: start it, answer every request the kernel asks for, resume until done. */
    evaluate(orbital: string, request: OrbitalEventRequest, scope: KernelAnswerScope): Promise<OrbitalEventResponse>;
}
/** What `evaluateOrbitalEvent` needs to run a request on the kernel instead of the JS composition. */
interface KernelEvaluation {
    engine: KernelEngine;
    /** The orbital the request is addressed to. */
    orbital: string;
    outsideEventQueue?: <T>(work: () => Promise<T>) => Promise<T>;
    onStream?: (item: EventStreamItem) => void;
}
/**
 * The request as the kernel takes it: the viewer and locale the host resolved, the `_targetTrait` sidecar
 * promoted to `targetTrait`, and the `_activeTraits` sidecar dropped (the kernel's mounted set is explicit,
 * not carried per request).
 */
declare function kernelRequest(request: OrbitalEventRequest, user: UserContext | undefined, locale: string | undefined): OrbitalEventRequest;
declare function evaluateOnKernel(kernel: KernelEvaluation, request: OrbitalEventRequest, user: UserContext | undefined, locale: string | undefined): Promise<OrbitalEventResponse>;

export { KernelEngine, type KernelEvaluation, evaluateOnKernel, kernelRequest };
