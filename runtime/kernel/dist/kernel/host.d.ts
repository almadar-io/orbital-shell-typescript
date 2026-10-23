import { PageFactField, BrowserPageFacts, PersistenceAdapter, ServiceParams, EventPayload, JsonValue, UserContext, ServiceHostPorts, OnDeviceModelPorts, BrowserTabPort, EventStreamItem } from '@almadar/core';
import { InFlightCalls } from '../effects/in-flight-calls.js';
import { ServiceCallContext } from '../service/service-provider.js';
import { ProgramEffectName, ProgramEffectOutcome } from './program-effects.js';
import { HttpPorts } from './http.js';
import { CallSiteWire, Settled, SubstrateFailureWire, IoRequestWire, IoAnswerWire } from '@almadar/core/kernel-wire';
import { OsHostPort, OsCompletionPort, OsCompletionEvent } from './os-port.js';
import './beacon.js';
import '../credentials/store.js';
import './decode.js';

/**
 * The host half of the kernel path: the I/O the kernel asks for, answered with the runtime's own
 * adapters. Persistence goes through the `PersistenceAdapter` (`@almadar/db`), `call-service` through the
 * injected provider (or the mock / integrations default the JS stage uses), substrate operators through
 * the program host. Nothing here decides an execution step.
 */

/** `call-service`, as the host answers it: the host's handler, mock mode, or the integrations default. */
type KernelCallService = (service: string, action: string, params: ServiceParams | undefined, context: ServiceCallContext | undefined) => Promise<EventPayload | null>;
/** A follow-on step's `call-service` outcome, run later as a dispatch of its own on `traitName`. */
interface DeferredCallOutcome {
    orbital: string;
    traitName: string;
    event: string;
    payload: EventPayload | undefined;
    entityId: string | undefined;
    originClientId: string | undefined;
    user: UserContext | undefined;
    locale: string | undefined;
}
interface SubstrateStreamSource {
    subscribe(message: (value: JsonValue) => void, ended: () => void): () => void;
}
interface KernelHostPorts {
    pageFacts?: (fields: readonly PageFactField[]) => BrowserPageFacts;
    persistence: PersistenceAdapter;
    callService: KernelCallService;
    /** The program host, read per call: a host wires it lazily. */
    programEffect: () => ((op: ProgramEffectName, args: readonly JsonValue[], context?: Pick<ServiceCallContext, 'principal' | 'role'>) => Promise<ProgramEffectOutcome>) | undefined;
    inFlightCalls: InFlightCalls;
    /** The running app lent to one `call-service` provider as the caller. */
    servicePorts: (caller: {
        orbital: string;
        trait: string;
    }, user: UserContext | undefined, message: (payload: EventPayload) => void, assertReentry?: () => void) => ServiceHostPorts;
    /** Deliver one live message of a running call (`emit.onMessage`) to the requesting tab only, never in-band. */
    deliverLive: (site: {
        orbital: string;
        trait: string;
        event: string;
    }, payload: EventPayload, originClientId: string | undefined) => void;
    /** Read per call: the sink a follow-on call's outcome runs through, absent when the host cannot deliver it to the tab. */
    deferCallOutcome: () => ((call: DeferredCallOutcome) => void) | undefined;
    /** The `http` effect's ports (kernel builder, secrets, egress); absent, an `http` ask fails as unavailable. */
    http?: HttpPorts;
    /** The on-device model and embedder; absent, a `browser/prompt` or `browser/embed` ask fails `unconfigured`. */
    onDevice?: OnDeviceModelPorts;
    /** The browser's tabs for the `browser/tab-*` effects; absent, a tab ask fails `unavailable`. */
    tabs?: BrowserTabPort;
    /** The `os` effect's host (Node: `createNodeOsHost` from `@almadar/shell-node`); absent, every `os` ask is denied, as the native host does with none. */
    os?: OsHostPort;
    /** What the kernel decides about a deferred `os` call (which ops defer, the event an outcome fires); absent, every `os` ask is answered in place. */
    osCompletions?: OsCompletionPort;
    substrateStream?: (op: string, args: readonly JsonValue[], scope: KernelAnswerScope) => SubstrateStreamSource | undefined;
    substrateMessage?: (site: CallSiteWire, key: string, value: JsonValue) => OsCompletionEvent | null;
    substrateCompletion?: (site: CallSiteWire, key: string, op: string, outcome: Settled<JsonValue, SubstrateFailureWire>) => OsCompletionEvent | null;
    /** The host clock in epoch milliseconds, answering the kernel's `clock` ask; absent, the system clock. */
    now?: () => number;
}
/** What one dispatch brings to its answers. */
interface KernelAnswerScope {
    /** The orbital the request is addressed to. */
    orbital: string;
    /** The viewer the dispatch runs as; a substrate operator is called as them. */
    user?: UserContext;
    /** The requesting tab. */
    originClientId?: string;
    locale?: string;
    entityId?: string;
    /** Runs `work` with the host's event queue released (a service call must not hold the next event). */
    outsideEventQueue?: <T>(work: () => Promise<T>) => Promise<T>;
    onStream?: (item: EventStreamItem) => void;
    assertReentry?: () => void;
}
declare function writeRows(persistence: PersistenceAdapter, request: Extract<IoRequestWire, {
    kind: 'writeRows';
}>): Promise<IoAnswerWire>;
/** Tell the kernel what the adapter pushes down for each entity type, once, before the first dispatch. */
declare function declareCapabilities(persistence: PersistenceAdapter, declare: (entityType: string, queryJson: string, writeJson: string) => void, entityTypes: readonly string[]): void;
/** Answer one request of the kernel; a thrown adapter error becomes the request's declared failure. */
declare function answerRequest(ports: KernelHostPorts, request: IoRequestWire, scope: KernelAnswerScope): Promise<IoAnswerWire>;

export { type DeferredCallOutcome, type KernelAnswerScope, type KernelCallService, type KernelHostPorts, type SubstrateStreamSource, answerRequest, declareCapabilities, writeRows };
