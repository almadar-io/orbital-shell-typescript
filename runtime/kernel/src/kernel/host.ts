/**
 * The host half of the kernel path: the I/O the kernel asks for, answered with the runtime's own
 * adapters. Persistence goes through the `PersistenceAdapter` (`@almadar/db`), `call-service` through the
 * injected provider (or the mock / integrations default the JS stage uses), substrate operators through
 * the program host. Nothing here decides an execution step.
 */
import {
  credentialStatusConnected,
  type BrowserPageFacts,
  type PageFactField,
  isJsonObject,
  QueryDeclinedError,
  WriteDeclinedError,
  type EntityRow,
  type EventPayload,
  type EventStreamItem,
  type HostAskCompletion,
  type JsonObject,
  type JsonValue,
  type OnDeviceModelPorts,
  type PersistenceAdapter,
  type ProgramValidationIssue,
  type ServiceHostPorts,
  type ServiceParams,
  type UserContext,
} from '@almadar/core';
import { untilAborted, type InFlightCalls } from '../effects/in-flight-calls.js';
import type { ServiceCallContext } from '../service/service-provider.js';
import { isProgramEffect, type ProgramEffectName, type ProgramEffectOutcome } from './program-effects.js';

type ProgramEffectResult = Extract<ProgramEffectOutcome, { ok: true }>['result'];
import { embedOnDevice, OnDeviceModelFailure, promptOnDevice } from '../effects/on-device-model.js';
import { base64Standard, systemRandom, type CredentialAdminPort, type SecretPorts } from './secret-ports.js';
import type { EventRequest, OsError } from '@almadar/core/kernel-wire';
import type { CallSiteWire, IoAnswerWire, IoRequestWire, KernelModule, Settled, SubstrateFailureWire } from './wire.js';
import type { OsCompletionEvent, OsCompletionPort, OsHostPort, OsTlsPort } from './os-port.js';
import { TabHostFailure, type BrowserTabPort } from '@almadar/core';

function issuePayload(issue: ProgramValidationIssue): EventPayload {
  const payload: EventPayload = { code: issue.code, message: issue.message };
  if (issue.path !== undefined) payload.path = issue.path;
  if (issue.line !== undefined) payload.line = issue.line;
  if (issue.column !== undefined) payload.column = issue.column;
  return payload;
}

/** `call-service`, as the host answers it: the host's handler, mock mode, or the integrations default. */
export type KernelCallService = (
  service: string,
  action: string,
  params: ServiceParams | undefined,
  context: ServiceCallContext | undefined,
) => Promise<EventPayload | null>;

/** A follow-on step's `call-service` outcome, run later as a dispatch of its own on `traitName`. */
export interface DeferredCallOutcome {
  orbital: string;
  traitName: string;
  event: string;
  payload: EventPayload | undefined;
  entityId: string | undefined;
  originClientId: string | undefined;
  user: UserContext | undefined;
  locale: string | undefined;
}

export interface SubstrateStreamSource {
  subscribe(message: (value: JsonValue) => void, ended: () => void): () => void;
}

/** The `audio/*` asks: a sound or music key, absent where the op names none (stop every sound, stop the music). */
export type HostAudioAsk =
  | { op: 'audio/play-sound'; key: string }
  | { op: 'audio/stop-sound'; key: string | undefined }
  | { op: 'audio/change-music'; key: string | undefined }
  | { op: 'audio/stop-music' };

/** The one object `auth/sign-in` takes: the method and the credentials it needs. */
export type HostSignInRequest =
  | { method: 'google' }
  | { method: 'email'; email: string; password: string }
  | { method: 'emailLink'; email: string; continueUrl: string }
  | { method: 'emailLink'; email: string; link: string }
  | { method: 'customToken'; token: string };

/** What a sign-in answers: the viewer, or `{ sent: true }` for an email link that was only sent. */
export type HostSignInAnswer = { uid: string; email?: string; displayName?: string } | { sent: true };

/** Why a host ask failed: the viewer closed it, the provider denied it, the request was malformed, or the host has no such action. */
export type HostAskFailureKind = 'cancelled' | 'denied' | 'invalid' | 'unavailable';

/** A host action's own failure, carrying the kind the completion reports. */
export class HostAskError extends Error {
  constructor(readonly kind: HostAskFailureKind, message: string) {
    super(message);
  }
}

/** What the client host does for the `audio/*`, `auth/sign-out` and `auth/sign-in` asks; a host that has none refuses them by name. */
export interface KernelHostActions {
  audio?: (ask: HostAudioAsk) => void;
  signOut?: () => void | Promise<void>;
  signIn?: (request: HostSignInRequest) => Promise<HostSignInAnswer>;
}

/** A host ask's answer: the payload of its success route, or the error and kind of its failure route. */
export type HostAskOutcome = { ok: JsonObject } | { error: string; kind: HostAskFailureKind };

/** The event a host's answer dispatches: to `trait` (on `entity` when the frame is a row), carrying `payload`. */
export interface HostAskReturn {
  trait: string;
  entity?: string;
  event: string;
  payload: JsonObject;
}

export interface KernelHostPorts {
  hostActions?: KernelHostActions;
  pageFacts?: (fields: readonly PageFactField[]) => BrowserPageFacts;
  persistence: PersistenceAdapter;
  callService: KernelCallService;
  /** The program host, read per call: a host wires it lazily. */
  programEffect: () => ((op: ProgramEffectName, args: readonly JsonValue[], context?: Pick<ServiceCallContext, 'principal' | 'role'>) => Promise<ProgramEffectOutcome>) | undefined;
  inFlightCalls: InFlightCalls;
  /** The running app lent to one `call-service` provider as the caller. */
  servicePorts: (caller: { orbital: string; trait: string }, user: UserContext | undefined, message: (payload: EventPayload) => void, assertReentry?: () => void) => ServiceHostPorts;
  /** Deliver one live message of a running call (`emit.onMessage`) to the requesting tab only, never in-band. */
  deliverLive: (site: { orbital: string; trait: string; event: string }, payload: EventPayload, originClientId: string | undefined) => void;
  /** Read per call: the sink a follow-on call's outcome runs through, absent when the host cannot deliver it to the tab. */
  deferCallOutcome: () => ((call: DeferredCallOutcome) => void) | undefined;
  /** The secret store, CSPRNG and credential administration ports the kernel's secret, random and credential asks use. */
  secretPorts?: SecretPorts;
  /** The on-device model and embedder; absent, a `browser/prompt` or `browser/embed` ask fails `unconfigured`. */
  onDevice?: OnDeviceModelPorts;
  /** The browser's tabs for the `browser/tab-*` effects; absent, a tab ask fails `unavailable`. */
  tabs?: BrowserTabPort;
  /** The `os` effect's host (Node: `createNodeOsHost` from `@almadar/shell-node`); absent, every `os` ask is denied, as the native host does with none. */
  os?: OsHostPort;
  /** What the kernel decides about a deferred `os` call (which ops defer, the event an outcome fires); absent, every `os` ask is answered in place. */
  osCompletions?: OsCompletionPort;
  /** The kernel's TLS state for sockets it owns (EXEC-HTTP-7); absent, a deferred outcome reaches its route as the host gave it. */
  osTls?: OsTlsPort;
  /** The kernel's typed parse of a `program/dispatch` event request; absent, that ask is refused. */
  parseEventRequest?: EventRequestParser;
  substrateStream?: (op: string, args: readonly JsonValue[], scope: KernelAnswerScope) => SubstrateStreamSource | undefined;
  substrateMessage?: (site: CallSiteWire, key: string, value: JsonValue) => OsCompletionEvent | null;
  substrateCompletion?: (site: CallSiteWire, key: string, op: string, args: readonly JsonValue[], outcome: Settled<JsonValue, SubstrateFailureWire>) => OsCompletionEvent | null;
  /** The host clock in epoch milliseconds, answering the kernel's `clock` ask; absent, the system clock. */
  now?: () => number;
}

/** What one dispatch brings to its answers. */
export interface KernelAnswerScope {
  /** The orbital the request is addressed to. */
  orbital: string;
  /** The viewer the dispatch runs as; a substrate operator is called as them. */
  user?: UserContext;
  /** The requesting tab. */
  originClientId?: string;
  locale?: string;
  entityId?: string;
  onStream?: (item: EventStreamItem) => void;
  assertReentry?: () => void;
}

/** A program effect's document (a program, an inspection, a catalog) as the JSON it travels as; the one clone left, for documents that are no wire type. */
function programDocumentJson(document: ProgramEffectResult): JsonValue {
  return JSON.parse(JSON.stringify(document));
}

/** The kernel's typed parse of a `program/dispatch` event request: the request, or the reason it is none. */
export type EventRequestParser = (payload: JsonObject, options: JsonObject) => Settled<EventRequest, string>;

/** The request parser over the kernel module: `EventRequest::from_dispatch`, not copied. */
export function kernelEventRequestParser(kernel: Pick<KernelModule, 'parseEventRequest'>): EventRequestParser {
  return (payload, options) => {
    try {
      return { ok: kernel.parseEventRequest(JSON.stringify(payload), JSON.stringify(options)) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
}

async function settle<T>(work: () => Promise<T>): Promise<Settled<T, string>> {
  try {
    return { ok: await work() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function serviceParams(args: JsonValue): ServiceParams | undefined {
  if (args === null) return undefined;
  if (!isJsonObject(args)) throw new Error('call-service: the arguments are not an object');
  return args;
}

function failureMessage<T>(error: T): string {
  return error instanceof Error ? error.message : String(error);
}

async function callService(
  ports: KernelHostPorts,
  request: Extract<IoRequestWire, { kind: 'callService' }>,
  scope: KernelAnswerScope,
): Promise<IoAnswerWire> {
  const { service, method, args, key, caller, site } = request;
  const identity = caller !== undefined ? { principal: caller.principal, ...(caller.role !== undefined ? { role: caller.role } : {}) } : {};
  const orbital = site?.orbital ?? scope.orbital;
  const onMessage = site?.emit.onMessage;
  const message = (payload: EventPayload): void => {
    if (site === undefined || onMessage === undefined) return;
    ports.deliverLive({ orbital, trait: site.trait, event: onMessage }, payload, scope.originClientId);
  };
  const call = async (signal?: AbortSignal, outsideRequest?: true): Promise<JsonValue> => {
    const host = site !== undefined ? ports.servicePorts({ orbital, trait: site.trait }, scope.user, message, outsideRequest === true ? undefined : scope.assertReentry) : undefined;
    const context: ServiceCallContext | undefined =
      caller !== undefined || signal !== undefined || host !== undefined || outsideRequest !== undefined
        ? { ...identity, ...(host !== undefined ? { host } : {}), ...(signal !== undefined ? { signal } : {}), ...(outsideRequest !== undefined ? { outsideRequest } : {}) }
        : undefined;
    const result = await ports.callService(service, method, serviceParams(args), context);
    return result;
  };
  const deferred = site?.followOn === true ? ports.deferCallOutcome() : undefined;
  if (site !== undefined && deferred !== undefined) {
    startDeferredCall(deferred, site, key, call, { ports, orbital, scope });
    return { kind: 'serviceDeferred' };
  }
  const run = async (): Promise<IoAnswerWire> => {
    if (key === undefined) return { kind: 'service', result: { ok: await call() } };
    const outcome = await ports.inFlightCalls.run(key, (signal) => untilAborted(signal, call(signal)));
    return outcome.cancelled ? { kind: 'serviceCancelled' } : { kind: 'service', result: { ok: outcome.value } };
  };
  try {
    return await run();
  } catch (error) {
    return { kind: 'service', result: { error: failureMessage(error) } };
  }
}

/** A follow-on step's call: started, not awaited; its outcome event goes to the host as a dispatch of its own. */
function startDeferredCall(
  defer: (call: DeferredCallOutcome) => void,
  site: CallSiteWire,
  key: string | undefined,
  call: (signal?: AbortSignal, outsideRequest?: true) => Promise<JsonValue>,
  context: { ports: KernelHostPorts; orbital: string; scope: KernelAnswerScope },
): void {
  const { ports, orbital, scope } = context;
  const deliver = (event: string, payload: EventPayload | undefined): void =>
    defer({
      orbital,
      traitName: site.trait,
      event,
      payload,
      entityId: scope.entityId,
      originClientId: scope.originClientId,
      user: scope.user,
      locale: scope.locale,
    });
  const outcome = key === undefined
    ? call(undefined, true).then((value) => ({ cancelled: false as const, value }))
    : ports.inFlightCalls.run(key, (signal) => untilAborted(signal, call(signal, true)));
  void outcome.then(
    (settled) => {
      if (settled.cancelled) {
        if (site.emit.cancelled !== undefined && key !== undefined) deliver(site.emit.cancelled, { key });
      } else if (site.emit.success !== undefined) {
        deliver(site.emit.success, keyed(settled.value === null ? undefined : toEventPayload(settled.value), key));
      }
    },
    (error) => {
      if (site.emit.failure !== undefined) deliver(site.emit.failure, keyed({ error: failureMessage(error) }, key));
    },
  );
}

/** A completion payload with the call's key beside it; a payload that is not a record is left as it is. */
function keyed(payload: EventPayload | undefined, key: string | undefined): EventPayload | undefined {
  return payload !== undefined && key !== undefined ? { ...payload, key } : payload;
}

function toEventPayload(value: JsonValue): EventPayload | undefined {
  return isJsonObject(value) ? value : undefined;
}

async function substrate(
  ports: KernelHostPorts,
  request: Extract<IoRequestWire, { kind: 'substrate' }>,
  scope: KernelAnswerScope,
): Promise<IoAnswerWire> {
  const { key, site } = request;
  const sink = ports.deferCallOutcome();
  const complete = ports.substrateCompletion;
  if (key === undefined || site === undefined || sink === undefined || complete === undefined) return substrateInPlace(ports, request, scope);
  const source = site.emit.onMessage !== undefined ? ports.substrateStream?.(request.op, request.args, scope) : undefined;
  if (ports.inFlightCalls.inFlight(key)) return { kind: 'substrate', result: { error: { message: source !== undefined ? `key ${key} already has a stream open` : `key ${key} already has a completion pending`, errors: [] } } };
  const deliver = (fired: OsCompletionEvent | null): void => {
    if (fired !== null) sink({ orbital: site.orbital ?? scope.orbital, traitName: site.trait, event: fired.event, payload: isJsonObject(fired.payload) ? fired.payload : undefined, entityId: site.entityId, originClientId: scope.originClientId, user: scope.user, locale: scope.locale });
  };
  const failed = <T>(error: T): void => deliver(complete(site, key, request.op, request.args, { error: { message: failureMessage(error), errors: [] } }));
  if (source !== undefined && ports.substrateMessage !== undefined) {
    const message = ports.substrateMessage;
    void ports.inFlightCalls.run(key, (signal) => new Promise<void>((resolve) => {
      let unsubscribe: (() => void) | undefined;
      let ended = false;
      const end = (): void => { ended = true; unsubscribe?.(); signal.removeEventListener('abort', end); resolve(); };
      signal.addEventListener('abort', end, { once: true });
      unsubscribe = source.subscribe((value) => {
        if (signal.aborted) return;
        const fired = message(site, key, value);
        deliver(fired);
      }, end);
      if (ended) unsubscribe();
    })).catch(failed);
    return { kind: 'serviceDeferred' };
  }
  const pending = ports.inFlightCalls.run(key, (signal) => untilAborted(signal, substrateInPlace(ports, request, { ...scope, assertReentry: undefined })));
  void pending.then((outcome) => {
    if (outcome.cancelled || outcome.value.kind !== 'substrate') return;
    deliver(complete(site, key, request.op, request.args, outcome.value.result));
  }, failed);
  return { kind: 'serviceDeferred' };
}

function optionalKey(op: string, args: readonly JsonValue[]): { key: string | undefined } | { error: string } {
  if (args.length === 0) return { key: undefined };
  const [key] = args;
  if (args.length === 1 && typeof key === 'string' && key !== '') return { key };
  return { error: `${op}: the key must be one non-empty text` };
}

/** `audio/*` and `auth/sign-out`: one ask each, performed by the host's actions; a host without them refuses by name. */
export async function performHostAsk(
  actions: KernelHostActions | undefined,
  op: string,
  args: readonly JsonValue[],
): Promise<Settled<null, string>> {
  const fail = (message: string): Settled<null, string> => ({ error: message });
  if (op === 'auth/sign-out') {
    if (args.length !== 0) return fail('auth/sign-out takes no arguments');
    if (actions?.signOut === undefined) return fail('no host sign-out is configured for auth/sign-out');
    try {
      await actions.signOut();
      return { ok: null };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
  const audio = actions?.audio;
  if (audio === undefined) return fail(`no host audio is configured for ${op}`);
  let ask: HostAudioAsk;
  if (op === 'audio/stop-music') {
    if (args.length !== 0) return fail('audio/stop-music takes no arguments');
    ask = { op };
  } else {
    const parsed = optionalKey(op, args);
    if ('error' in parsed) return fail(parsed.error);
    if (op === 'audio/play-sound') {
      if (parsed.key === undefined) return fail('audio/play-sound: the key must be one non-empty text');
      ask = { op, key: parsed.key };
    } else if (op === 'audio/stop-sound' || op === 'audio/change-music') {
      ask = { op, key: parsed.key };
    } else {
      return fail(`no host action is configured for ${op}`);
    }
  }
  try {
    audio(ask);
    return { ok: null };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

const SIGN_IN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  google: ['method'],
  email: ['method', 'email', 'password'],
  emailLink: ['method', 'email', 'continueUrl', 'link'],
  customToken: ['method', 'token'],
};

/** The `auth/sign-in` request an ask carries, or why it is refused before the host is asked. */
export function parseSignInRequest(args: readonly JsonValue[]): { request: HostSignInRequest } | { error: string } {
  const [request] = args;
  if (args.length !== 1 || !isJsonObject(request)) return { error: 'auth/sign-in takes one request object' };
  const method = request.method;
  const allowed = typeof method === 'string' ? SIGN_IN_FIELDS[method] : undefined;
  if (typeof method !== 'string' || allowed === undefined) return { error: 'auth/sign-in: method must be google, email, emailLink or customToken' };
  const text = (field: string): string | undefined => {
    const value = request[field];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };
  for (const field of Object.keys(request)) {
    if (!allowed.includes(field)) return { error: `auth/sign-in: ${field} is not a field of the ${method} method` };
  }
  if (method === 'google') return { request: { method } };
  if (method === 'email') {
    const email = text('email');
    const password = text('password');
    return email !== undefined && password !== undefined ? { request: { method, email, password } } : { error: 'auth/sign-in: email takes an email and a password' };
  }
  if (method === 'customToken') {
    const token = text('token');
    return token !== undefined ? { request: { method, token } } : { error: 'auth/sign-in: customToken takes a token' };
  }
  const email = text('email');
  const continueUrl = text('continueUrl');
  const link = text('link');
  if (email === undefined || (continueUrl === undefined) === (link === undefined)) {
    return { error: 'auth/sign-in: emailLink takes an email and exactly one of continueUrl (send the link) or link (complete the sign-in)' };
  }
  return continueUrl !== undefined ? { request: { method: 'emailLink', email, continueUrl } } : { request: { method: 'emailLink', email, link: link as string } };
}

/** The answer of one host ask whose completion the host returns: `auth/sign-in` through the host's sign-in, any other op as it is performed (an empty success). */
export async function performHostAnswer(actions: KernelHostActions | undefined, op: string, args: readonly JsonValue[]): Promise<HostAskOutcome> {
  if (op !== 'auth/sign-in') {
    const outcome = await performHostAsk(actions, op, args);
    return 'error' in outcome ? { error: outcome.error, kind: 'unavailable' } : { ok: {} };
  }
  const parsed = parseSignInRequest(args);
  if ('error' in parsed) return { error: parsed.error, kind: 'invalid' };
  if (actions?.signIn === undefined) return { error: 'no host sign-in is configured for auth/sign-in', kind: 'unavailable' };
  try {
    const answer = await actions.signIn(parsed.request);
    const fields: JsonObject = {};
    if ('sent' in answer) fields.sent = true;
    else {
      fields.uid = answer.uid;
      if (answer.email !== undefined) fields.email = answer.email;
      if (answer.displayName !== undefined) fields.displayName = answer.displayName;
    }
    return { ok: fields };
  } catch (error) {
    if (error instanceof HostAskError) return { error: error.message, kind: error.kind };
    return { error: error instanceof Error ? error.message : String(error), kind: 'unavailable' };
  }
}

/** The event `outcome` fires on the ask's declared route, or undefined when the ask declared none for it (nothing fires). */
export function hostAskReturn(completion: HostAskCompletion, outcome: HostAskOutcome): HostAskReturn | undefined {
  const keyed: JsonObject = completion.key !== undefined ? { key: completion.key } : {};
  const event = 'ok' in outcome ? completion.success : completion.failure;
  if (event === undefined) return undefined;
  const payload: JsonObject = 'ok' in outcome ? { ...outcome.ok, ...keyed } : { error: outcome.error, kind: outcome.kind, ...keyed };
  return { trait: completion.trait, ...(completion.entity !== undefined ? { entity: completion.entity } : {}), event, payload };
}

async function hostAction(
  ports: KernelHostPorts,
  request: Extract<IoRequestWire, { kind: 'substrate' }>,
): Promise<IoAnswerWire> {
  const outcome = await performHostAsk(ports.hostActions, request.op, request.args);
  return 'error' in outcome
    ? { kind: 'substrate', result: { error: { message: outcome.error, errors: [] } } }
    : { kind: 'substrate', result: { ok: null } };
}

async function substrateInPlace(
  ports: KernelHostPorts,
  request: Extract<IoRequestWire, { kind: 'substrate' }>,
  scope: KernelAnswerScope,
): Promise<IoAnswerWire> {
  if (request.op === 'auth/sign-in') return { kind: 'substrate', result: { error: { message: 'auth/sign-in runs on the client host: a server-role kernel cannot ask it', errors: [] } } };
  if (request.op.startsWith('audio/') || request.op === 'auth/sign-out') return hostAction(ports, request);
  if (request.op === 'program/live') return { kind: 'substrate', result: { error: { message: 'program/live streams to its onMessage route: give it a key and an onMessage route', errors: [] } } };
  const handler = ports.programEffect();
  const failure = (message: string, errors: JsonValue[] = []): IoAnswerWire => {
    const detail: SubstrateFailureWire = { message, errors };
    return { kind: 'substrate', result: { error: detail } };
  };
  if (request.op === 'program/dispatch' || request.op === 'program/inputs') {
    const lent = ports.servicePorts({ orbital: scope.orbital, trait: '' }, scope.user, () => {}, scope.assertReentry);
    try {
      const delivered = await deliverAgentAsk(request.op, request.args, lent, ports);
      if (delivered.ok) return { kind: 'substrate', result: { ok: delivered.result } };
      return failure(delivered.error, delivered.errors ?? []);
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  }
  if (handler === undefined) return failure(`no program host configured for ${request.op}`);
  if (!isProgramEffect(request.op)) return failure(`no program host configured for ${request.op}`);
  try {
    const user = scope.user;
    const outcome = await handler(request.op, request.args, user !== undefined ? { principal: user.id, ...(user.role !== undefined ? { role: user.role } : {}) } : undefined);
    if (outcome.ok) return { kind: 'substrate', result: { ok: programDocumentJson(outcome.result) } };
    return failure(outcome.error, (outcome.errors ?? []).map((issue) => issuePayload(issue)));
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

type Delivered = { ok: true; result: JsonValue } | { ok: false; error: string; errors?: JsonValue[] };

/** An empty text, record or list in an event request is absent, as the HTTP routes read it. */
function present(value: JsonValue | undefined): value is JsonValue {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isJsonObject(value)) return Object.keys(value).length > 0;
  return true;
}

/**
 * The asks the kernel plans for `program/dispatch` and `program/inputs` (EXEC-AGENT-1), delivered raw: an inbound
 * delivery, a declared input, an event request, or the trace. The kernel checks and shapes; the host only delivers.
 */
async function deliverAgentAsk(op: 'program/dispatch' | 'program/inputs', args: readonly JsonValue[], host: ServiceHostPorts, ports: Pick<KernelHostPorts, 'parseEventRequest'>): Promise<Delivered> {
  const [first, second, third] = args;
  if (op === 'program/inputs') {
    const steps = args.length === 1 && isJsonObject(first) ? first['trace'] : undefined;
    if (typeof steps !== 'number') return { ok: false, error: 'program/inputs: the host is asked for { trace } only' };
    if (host.trace === undefined) return { ok: false, error: 'program/inputs: this host keeps no dispatch trace' };
    return { ok: true, result: host.trace(steps) };
  }
  if (args.length === 1 && isJsonObject(first)) {
    const { inbound, body, headers } = first;
    if (typeof inbound !== 'string' || typeof body !== 'string' || !isJsonObject(headers)) return { ok: false, error: 'program/dispatch: the host is asked for { inbound, body, headers }' };
    if (host.deliverInbound === undefined) return { ok: false, error: 'program/dispatch: this host does not deliver inbound requests' };
    const named: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) if (typeof value === 'string') named[key] = value;
    const answer = await host.deliverInbound(inbound, { headers: named, rawBody: body });
    return { ok: true, result: { status: answer.status, body: answer.body } };
  }
  if (typeof first !== 'string' || second === undefined || !isJsonObject(second)) return { ok: false, error: 'program/dispatch: the host is asked for a qualified address and a payload record' };
  const payload = second;
  if (isJsonObject(third)) {
    if (host.dispatchRequest === undefined) return { ok: false, error: 'program/dispatch: this host does not serve event requests' };
    const stream = third['stream'] === true;
    if (stream && host.supportsDispatchStream !== true) return { ok: false, error: 'program/dispatch: this host does not answer stream items' };
    const parse = ports.parseEventRequest;
    if (parse === undefined) return { ok: false, error: 'program/dispatch: this host has no kernel to parse an event request' };
    const parsed = parse(payload, third);
    if ('error' in parsed) return { ok: false, error: parsed.error, errors: [{ code: 'INVALID_REQUEST', message: parsed.error, status: 400 }] };
    const orbital = typeof third['orbital'] === 'string' ? third['orbital'] : '';
    const answered = await host.dispatchRequest(orbital, parsed.ok, third['input'] === true, stream);
    if (!answered.ok) return { ok: false, error: answered.error, errors: [{ code: answered.code, message: answered.error, status: answered.status }] };
    if (!stream) return { ok: true, result: answered.response };
    if (answered.streamItems === undefined) return { ok: false, error: 'program/dispatch: this host does not answer stream items' };
    return { ok: true, result: { ...answered.response, items: answered.streamItems } };
  }
  const event = first.lastIndexOf('.');
  const trait = first.lastIndexOf('.', event - 1);
  if (event < 0 || trait < 0) return { ok: false, error: `program/dispatch: '${first}' is not a qualified address` };
  const response = await host.dispatchInput(first.slice(0, trait), { targetTrait: first.slice(trait + 1, event), event: first.slice(event + 1), payload });
  return { ok: true, result: response };
}

const SECRET_PORTS_UNAVAILABLE = 'SECRET_PORTS_UNAVAILABLE: this host was given no secret ports';

/** `prompt` / `embed`: the host's on-device model or embedder; keyed, a `cancel-call` aborts the ask and a late reply is dropped. */
async function onDeviceModel(ports: KernelHostPorts, request: Extract<IoRequestWire, { kind: 'prompt' | 'embed' }>, scope: KernelAnswerScope): Promise<IoAnswerWire> {
  const { key } = request;
  const ask = async (signal?: AbortSignal): Promise<IoAnswerWire> =>
    request.kind === 'prompt'
      ? { kind: 'prompt', result: { ok: await promptOnDevice(ports.onDevice, request.text, request.schema, key ?? null, signal) } }
      : { kind: 'embed', result: { ok: await embedOnDevice(ports.onDevice, request.texts, key ?? null, signal) } };
  const run = async (): Promise<IoAnswerWire> => {
    if (key === undefined) return ask();
    const outcome = await ports.inFlightCalls.run(key, (signal) => untilAborted(signal, ask(signal)));
    return outcome.cancelled ? { kind: 'serviceCancelled' } : outcome.value;
  };
  try {
    return await run();
  } catch (error) {
    const failure = error instanceof OnDeviceModelFailure ? { kind: error.kind, message: error.message } : { kind: 'failed' as const, message: failureMessage(error) };
    return request.kind === 'prompt' ? { kind: 'prompt', result: { error: failure } } : { kind: 'embed', result: { error: failure } };
  }
}

const NO_TAB_HOST = 'browser/tab: no host answers browser tabs';

/**
 * `tab`: one raw ask of a `browser/tab-*` effect handed to the host's tab port, which performs it and holds no
 * decision. Keyed, a `cancel-call` aborts the ask and a late reply is dropped. A watch's elements are dispatched to the
 * declared input its ask names, as the user the watch was started by.
 */
async function tab(ports: KernelHostPorts, request: Extract<IoRequestWire, { kind: 'tab' }>, scope: KernelAnswerScope): Promise<IoAnswerWire> {
  const { ask, key } = request;
  const port = ports.tabs;
  if (port === undefined) return { kind: 'tab', result: { error: { kind: 'unavailable', message: NO_TAB_HOST } } };
  const deliver = (payload: EventPayload): void => {
    if (ask.kind !== 'watch') return;
    const target = ask.deliver;
    const lent = ports.servicePorts({ orbital: target.orbital, trait: target.trait }, scope.user, () => {});
    void lent.dispatchInput(target.orbital, { targetTrait: target.trait, event: target.event, payload });
  };
  const perform = async (signal?: AbortSignal): Promise<IoAnswerWire> => {
    try {
      return { kind: 'tab', result: { ok: await port.perform(ask, { ...(signal !== undefined ? { signal } : {}), deliver }) } };
    } catch (error) {
      if (error instanceof TabHostFailure) return { kind: 'tab', result: { error: { kind: error.kind, message: error.message } } };
      return { kind: 'tab', result: { error: { kind: 'failed', message: failureMessage(error) } } };
    }
  };
  const run = async (): Promise<IoAnswerWire> => {
    if (key === undefined) return perform();
    const outcome = await ports.inFlightCalls.run(key, (signal) => untilAborted(signal, perform(signal)));
    return outcome.cancelled ? { kind: 'serviceCancelled' } : outcome.value;
  };
  return run();
}

/** `pageFacts`: the requested facts read from the page this host runs in; no window or document is `available: false`. */
async function pageFacts(ports: KernelHostPorts, request: Extract<IoRequestWire, { kind: 'pageFacts' }>): Promise<IoAnswerWire> {
  return { kind: 'pageFacts', result: await settle(async () => ports.pageFacts?.(request.fields) ?? { available: false, hostname: '', referrer: '', screenWidth: null, href: '' }) };
}

/**
 * A deferred raw `os` outcome that belongs to a TLS operation the kernel parked (EXEC-HTTP-7) is finished in the kernel:
 * it decrypts or encrypts the raw outcome and, while it needs more raw bytes, asks the host's `os` port for them. Any
 * other key's outcome is returned as it stands.
 */
export function finishTls(ports: KernelHostPorts, os: OsHostPort, key: string, raw: Settled<JsonValue, OsError>): Promise<Settled<JsonValue, OsError>> {
  return new Promise((resolve) => completeTls(ports, os, key, raw, resolve));
}

/**
 * The same loop, handing the outcome to `finish` in the calling turn whenever the kernel needs no further raw ask
 * (nothing parked, or done at once); only a parked operation's follow-up ask makes it wait (EXEC-QUEUE-10/13).
 */
export function completeTls(ports: KernelHostPorts, os: OsHostPort, key: string, raw: Settled<JsonValue, OsError>, finish: (outcome: Settled<JsonValue, OsError>) => void): void {
  const tls = ports.osTls;
  if (tls === undefined) { finish(raw); return; }
  const step = (outcome: Settled<JsonValue, OsError>, parked: boolean): void => {
    const next = tls.complete(key, outcome);
    if (next === null) { finish(parked ? { error: { kind: 'tls', message: 'the TLS operation vanished' } } : outcome); return; }
    if ('done' in next) { finish(next.done); return; }
    void os.answer(next.ask.op, next.ask.args).then((answered) => step(answered, true));
  };
  step(raw, false);
}

/**
 * `os`: the raw ask handed to the host's `os` port; the grants and every answer shape are the port's. A keyed ask of a
 * completion-deferring op under a declared route is started and answered `serviceDeferred` when the host can run its
 * outcome as a dispatch of its own (EXEC-QUEUE-10); its completion event is the kernel's.
 */
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * An `os/send` whose data operand is a list of segments (standard base64 text, or `{ credential }`) becomes one bytes
 * operand here, at the boundary: the credential's value is read from the host's secret store and exists only in this
 * call, never in program data, the journal or the answer.
 */
async function withCredentialSegments(ports: KernelHostPorts, op: string, args: JsonValue[]): Promise<{ args: JsonValue[] } | { error: OsError }> {
  const segments = args[1];
  if (op !== 'os/send' || !Array.isArray(segments)) return { args };
  const parts: Uint8Array[] = [];
  for (const [at, segment] of segments.entries()) {
    if (typeof segment === 'string') {
      if (!CANONICAL_BASE64.test(segment)) return { error: { kind: 'invalid', message: `${op}: segment ${at + 1} is not standard base64` } };
      parts.push(Uint8Array.from(atob(segment), (c) => c.charCodeAt(0)));
      continue;
    }
    const name = isJsonObject(segment) ? segment['credential'] : undefined;
    if (typeof name !== 'string') return { error: { kind: 'invalid', message: `${op}: segment ${at + 1} is neither bytes nor a credential` } };
    const store = ports.secretPorts?.secrets;
    if (store === undefined) return { error: { kind: 'denied', message: `${op}: no credential source is configured` } };
    let held: string | undefined | null;
    try {
      held = await store.get(name, undefined);
    } catch (error) {
      return { error: { kind: 'io', message: `${op}: credential ${name}: ${error instanceof Error ? error.message : String(error)}` } };
    }
    if (held === undefined || held === null) return { error: { kind: 'denied', message: `${op}: credential ${name} is not held` } };
    parts.push(new TextEncoder().encode(held));
  }
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return { args: [args[0] ?? null, base64Standard(bytes), ...args.slice(2)] };
}

async function osAnswer(ports: KernelHostPorts, request: Extract<IoRequestWire, { kind: 'os' }>, scope: KernelAnswerScope): Promise<IoAnswerWire> {
  const { os } = ports;
  if (os === undefined) return { kind: 'os', result: { error: { kind: 'denied', message: `${request.op}: no os host configured` } } };
  const { op, key, site } = request;
  const completions = ports.osCompletions;
  const sink = ports.deferCallOutcome();
  const message = ports.substrateMessage;
  const streaming = key !== undefined && site !== undefined && completions !== undefined && sink !== undefined && message !== undefined && os.stream !== undefined && completions.streams(op);
  const deferring = !streaming && key !== undefined && site !== undefined && completions !== undefined && sink !== undefined && os.defer !== undefined && completions.defers(op);
  const lease = (streaming || deferring) && key !== undefined ? ports.inFlightCalls.reserve(key) : undefined;
  if ((streaming || deferring) && lease === undefined) {
    return { kind: 'os', result: { error: { kind: 'invalid', message: `${op}: key ${key} already has ${streaming ? 'a stream open' : 'a completion pending'}` } } };
  }
  const segmented = await withCredentialSegments(ports, op, request.args);
  if ('error' in segmented) {
    lease?.release();
    return { kind: 'os', result: segmented };
  }
  if (lease?.signal.aborted === true) {
    lease.release();
    return { kind: 'serviceCancelled' };
  }
  const { args } = segmented;
  if (lease !== undefined && streaming && key !== undefined && site !== undefined && completions !== undefined && sink !== undefined && message !== undefined && os.stream !== undefined) {
    const orbital = site.orbital ?? scope.orbital;
    const stop = (): void => { os.cancel?.(key); lease.release(); };
    lease.signal.addEventListener('abort', stop, { once: true });
    const deliver = (fired: OsCompletionEvent | null): boolean => {
      if (fired === null || lease.signal.aborted) return false;
      sink({ orbital, traitName: site.trait, event: fired.event, payload: isJsonObject(fired.payload) ? fired.payload : undefined, entityId: site.entityId, originClientId: scope.originClientId, user: scope.user, locale: scope.locale });
      return true;
    };
    const started = await os.stream(op, args, key, (value) => deliver(message(site, key, value)), (error) => {
      lease.release();
      lease.signal.removeEventListener('abort', stop);
      deliver(completions.event(site, key, { error }));
    });
    if ('error' in started) { lease.release(); lease.signal.removeEventListener('abort', stop); }
    return { kind: 'os', result: started };
  }
  if (lease !== undefined && deferring && key !== undefined && site !== undefined && completions !== undefined && sink !== undefined && os.defer !== undefined) {
    const orbital = site.orbital ?? scope.orbital;
    const cancel = (): void => { os.cancel?.(key); lease.release(); };
    lease.signal.addEventListener('abort', cancel, { once: true });
    const finish = (outcome: Settled<JsonValue, OsError>): void => {
      lease.release();
      lease.signal.removeEventListener('abort', cancel);
      if (lease.signal.aborted) return;
      const fired = completions.event(site, key, outcome);
      if (fired === null) return;
      sink({
        orbital,
        traitName: site.trait,
        event: fired.event,
        payload: isJsonObject(fired.payload) ? fired.payload : undefined,
        entityId: site.entityId,
        originClientId: scope.originClientId,
        user: scope.user,
        locale: scope.locale,
      });
    };
    const started = os.defer(op, args, key, (raw) => {
      completeTls(ports, os, key, raw, finish);
    });
    if ('error' in started) { lease.release(); lease.signal.removeEventListener('abort', cancel); }
    return 'error' in started ? { kind: 'os', result: started } : { kind: 'serviceDeferred' };
  }
  return { kind: 'os', result: await os.answer(op, args) };
}

async function secret(ports: KernelHostPorts, request: Extract<IoRequestWire, { kind: 'secret' }>): Promise<IoAnswerWire> {
  const store = ports.secretPorts?.secrets;
  if (store === undefined) return { kind: 'secret', result: { error: SECRET_PORTS_UNAVAILABLE } };
  return { kind: 'secret', result: await settle(async () => (await store.get(request.name, request.principal)) ?? null) };
}

async function secretSet(ports: KernelHostPorts, request: Extract<IoRequestWire, { kind: 'secretSet' }>): Promise<IoAnswerWire> {
  const store = ports.secretPorts?.secrets;
  if (store === undefined) return { kind: 'secretSet', result: { error: SECRET_PORTS_UNAVAILABLE } };
  return { kind: 'secretSet', result: await settle(async () => {
    await store.set(request.name, request.value, request.ttlMs, request.principal);
    return null;
  }) };
}

async function secretRotate(ports: KernelHostPorts, request: Extract<IoRequestWire, { kind: 'secretRotate' }>): Promise<IoAnswerWire> {
  const store = ports.secretPorts?.secrets;
  if (store === undefined) return { kind: 'secretRotate', result: { error: SECRET_PORTS_UNAVAILABLE } };
  const rotate = store.rotate;
  if (rotate === undefined) return { kind: 'secretRotate', result: { error: 'this host keeps no rotatable credentials' } };
  return { kind: 'secretRotate', result: await settle(async () => {
    await rotate.call(store, request.name, request.value, request.principal);
    return null;
  }) };
}

/** `random`: CSPRNG bytes (the ports' source, else the platform's), as standard base64. */
function random(ports: KernelHostPorts, request: Extract<IoRequestWire, { kind: 'random' }>): IoAnswerWire {
  const source = ports.secretPorts?.random ?? systemRandom;
  try {
    return { kind: 'random', result: { ok: base64Standard(source(request.bytes)) } };
  } catch (error) {
    return { kind: 'random', result: { error: failureMessage(error) } };
  }
}

async function credentialStatus(ports: KernelHostPorts, request: Extract<IoRequestWire, { kind: 'credentialStatus' }>): Promise<IoAnswerWire> {
  const store = ports.secretPorts?.secrets;
  if (store === undefined) return { kind: 'credentialStatus', result: { error: SECRET_PORTS_UNAVAILABLE } };
  return { kind: 'credentialStatus', result: await settle(async () => {
    const connected = credentialStatusConnected(await store.get(request.name, request.principal), request.principal);
    const label = connected ? await store.label?.(request.name, request.principal) : undefined;
    return { connected, ...(label !== undefined ? { label } : {}) };
  }) };
}

async function credentialForget(ports: KernelHostPorts, request: Extract<IoRequestWire, { kind: 'credentialForget' }>): Promise<IoAnswerWire> {
  const store = ports.secretPorts?.secrets;
  if (store === undefined) return { kind: 'credentialForget', result: { error: SECRET_PORTS_UNAVAILABLE } };
  return { kind: 'credentialForget', result: await settle(async () => {
    await store.forget(request.name, request.principal);
    return null;
  }) };
}

async function credentialAdmin<T>(ports: KernelHostPorts, work: (port: CredentialAdminPort) => Promise<T>): Promise<Settled<T, string>> {
  const port = ports.secretPorts?.credentials;
  if (port === undefined) return { error: SECRET_PORTS_UNAVAILABLE };
  return settle(() => work(port));
}

function rowData(value: JsonValue): EntityRow {
  if (!isJsonObject(value)) throw new Error('persist: the row is not an object');
  return value;
}

/** A pushed-down query: the adapter runs it where the data lives; a decline leaves nothing read. */
async function queryRows(persistence: PersistenceAdapter, request: Extract<IoRequestWire, { kind: 'queryRows' }>): Promise<IoAnswerWire> {
  const { entityType, query, project } = request;
  try {
    if (project === 'ids') {
      if (!persistence.queryIds) return { kind: 'queryUnsupported', reason: 'no-ids-capability' };
      return { kind: 'idPage', result: { ok: await persistence.queryIds(entityType, query) } };
    }
    if (!persistence.queryPage) return { kind: 'queryUnsupported', reason: 'no-query-capability' };
    return { kind: 'page', result: { ok: await persistence.queryPage(entityType, query) } };
  } catch (error) {
    if (error instanceof QueryDeclinedError) return { kind: 'queryUnsupported', reason: error.reason };
    return { kind: project === 'ids' ? 'idPage' : 'page', result: { error: failureMessage(error) } };
  }
}

/** Pushed-down writes: one op is a `writeWhere`, a run or a batch is a `writeBatch`. */
/** A compare-and-commit of rows the kernel decided (EXEC-STORE-5): the store applies them together or reports a conflict. */
async function commitRows(persistence: PersistenceAdapter, request: Extract<IoRequestWire, { kind: 'commitRows' }>): Promise<IoAnswerWire> {
  if (!persistence.commitRows) return { kind: 'committed', result: { error: 'this store does not commit rows' } };
  try {
    return { kind: 'committed', result: { ok: await persistence.commitRows(request.rows) } };
  } catch (error) {
    return { kind: 'committed', result: { error: failureMessage(error) } };
  }
}

export async function writeRows(persistence: PersistenceAdapter, request: Extract<IoRequestWire, { kind: 'writeRows' }>): Promise<IoAnswerWire> {
  const { batch } = request;
  try {
    if (!persistence.writeBatch) return { kind: 'writeUnsupported', reason: 'no-write-capability' };
    return { kind: 'wrote', result: { ok: await persistence.writeBatch(batch) } };
  } catch (error) {
    if (error instanceof WriteDeclinedError) return { kind: 'writeUnsupported', reason: error.reason };
    return { kind: 'wrote', result: { error: failureMessage(error) } };
  }
}

/** Tell the kernel what the adapter pushes down for each entity type, once, before the first dispatch. */
export function declareCapabilities(persistence: PersistenceAdapter, declare: (entityType: string, queryJson: string, writeJson: string) => void, entityTypes: readonly string[]): void {
  for (const entityType of entityTypes) {
    const query = persistence.queryPage ? persistence.queryCapabilities?.(entityType) : undefined;
    const write = persistence.writeWhere || persistence.writeBatch || persistence.commitRows ? persistence.writeCapabilities?.(entityType) : undefined;
    if (query === undefined && write === undefined) continue;
    declare(entityType, JSON.stringify(query ?? null), JSON.stringify(write ?? null));
  }
}

/** Answer one request of the kernel; a thrown adapter error becomes the request's declared failure. */
export async function answerRequest(ports: KernelHostPorts, request: IoRequestWire, scope: KernelAnswerScope): Promise<IoAnswerWire> {
  const { persistence } = ports;
  switch (request.kind) {
    case 'readRow':
      return {
        kind: 'row',
        result: await settle(async () => {
          const row = await persistence.getById(request.entityType, request.id);
          return row;
        }),
      };
    case 'listRows':
      return {
        kind: 'rows',
        result: await settle(async () => await persistence.list(request.entityType)),
      };
    case 'queryRows':
      return queryRows(persistence, request);
    case 'writeRows':
      return writeRows(persistence, request);
    case 'commitRows':
      return commitRows(persistence, request);
    case 'createRow':
      return {
        kind: 'row',
        result: await settle(async () => {
          const data = rowData(request.data);
          const { id } = await persistence.create(request.entityType, data);
          return (await persistence.getById(request.entityType, id)) ?? { ...data, id };
        }),
      };
    case 'writeRow':
      return {
        kind: 'row',
        result: await settle(async () => {
          const data = rowData(request.data);
          const existing = await persistence.getById(request.entityType, request.id);
          if (existing === null) await persistence.create(request.entityType, { ...data, id: request.id });
          else await persistence.update(request.entityType, request.id, { ...data, id: request.id });
          return (await persistence.getById(request.entityType, request.id)) ?? { ...existing, ...data, id: request.id };
        }),
      };
    case 'deleteRow':
      return {
        kind: 'deleted',
        result: await settle(async () => {
          await persistence.delete(request.entityType, request.id);
          return null;
        }),
      };
    case 'callService':
      return callService(ports, request, scope);
    case 'cancelCall':
      ports.inFlightCalls.cancel(request.key);
      ports.os?.cancel?.(request.key);
      return { kind: 'cancelled', result: { ok: null } };
    case 'substrate':
      return substrate(ports, request, scope);
    case 'pageFacts':
      return pageFacts(ports, request);
    case 'prompt':
    case 'embed':
      return onDeviceModel(ports, request, scope);
    case 'tab':
      return tab(ports, request, scope);
    case 'secret':
      return secret(ports, request);
    case 'secretSet':
      return secretSet(ports, request);
    case 'secretRotate':
      return secretRotate(ports, request);
    case 'random':
      return random(ports, request);
    case 'os':
      return osAnswer(ports, request, scope);
    case 'clock':
      return { kind: 'clock', result: { ok: (ports.now ?? Date.now)() } };
    case 'sealed':
      return { kind: 'sealed', result: { error: `${request.op}: a sealed operator is answered by the kernel, never by a host` } };
    case 'deliver':
      return { kind: 'deliver', result: { error: { kind: 'down', id: request.envelope.id } } };
    case 'credentialStatus':
      return credentialStatus(ports, request);
    case 'credentialForget':
      return credentialForget(ports, request);
    case 'credentialStoreList':
      return { kind: request.kind, result: await credentialAdmin(ports, (port) => port.list()) };
    case 'credentialStoreRead':
      return { kind: request.kind, result: await credentialAdmin(ports, (port) => port.read(request.name)) };
    case 'credentialStoreWrite':
      return { kind: request.kind, result: await credentialAdmin(ports, async (port) => { await port.write(request.service, request.name, request.value); return null; }) };
    case 'credentialStoreRemove':
      return { kind: request.kind, result: await credentialAdmin(ports, (port) => port.remove(request.name)) };
    case 'credentialStoreRotate':
      return { kind: request.kind, result: await credentialAdmin(ports, (port) => port.rotate()) };
    case 'credentialModeRead':
      return { kind: request.kind, result: await credentialAdmin(ports, (port) => port.mode()) };
    case 'credentialModeWrite':
      return { kind: request.kind, result: await credentialAdmin(ports, (port) => port.setMode(request.mode)) };
  }
}
