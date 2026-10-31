/**
 * The kernel-backed implementation of `evaluateOrbitalEvent` / `OrbitalServerRuntime`: the Rust kernel
 * (`@almadar/kernel`, WebAssembly) decides every execution step; this host answers the I/O it asks for
 * and nothing else. The continuation of a stopped dispatch never leaves the wasm instance.
 */
import { ExternalInputSchema, InboundAnswerSchema, InboundFoundSchema, InboundOnlySchema, NameListSchema, OptionalNameSchema, PayloadIssueSchema, PayloadJsonSchemaSchema, installKernelEvaluator, isEntityReferenceAny, MountSeedSchema, EntityRowSchema, EventPayloadSchema, type ExternalInput, type InboundAnswer, type InboundDelivery, type InboundRoute, type JsonSchema, type PayloadField, type PayloadIssue, type MountSeed, type EntityRow, type EventPayload, type EventStreamItem, type MessageCatalogs, type EventRequest, type EventResponse, type OrbitalSchema, type RowQueryPage, type RowSetRef, type UserContext, LiveBroadcastItemSchema, type LiveBroadcastItem } from '@almadar/core';
import type { ProgramSurface } from '@almadar/core/kernel-wire';
import { LaneHeldByParkedDispatch } from './lane.js';

import { decodeDueTicks, decodeNext, decodeProgress, decodeResolveProgress } from './decode.js';
import { answerRequest, declareCapabilities, type KernelAnswerScope, type KernelHostPorts } from './host.js';
import type { OsCompletionEvent } from './os-port.js';
import type { FiredByOrbital, IoReplyWire, KernelModule, KernelServerHandle, ServerProgressWire } from './wire.js';

/** Where a dispatch stands once the kernel runs it, with the stream of a finished one read the moment it finished. */
/** What the kernel's dispatch stream carries: event and effect items; the response comes in the dispatch's own answer. */
type KernelStreamItem = Extract<EventStreamItem, { type: 'event' | 'effect' }>;

type Running = { progress: Exclude<ServerProgressWire, { status: 'queued' }>; stream: string | undefined };

/** Work the kernel queued behind the lane: settled when the kernel runs it (`next`). */
interface Turn {
  readonly streams: boolean;
  readonly ran: (running: Running) => void;
  readonly failed: (error: Error) => void;
}

/** The kernel's `programSurface` answer, typed by the generated wire type. */
const PROGRAM_SURFACE = {
  parse(input: ReturnType<typeof JSON.parse>): ProgramSurface {
    return input;
  },
};

function declaredEntityTypes(schema: OrbitalSchema): string[] {
  return schema.orbitals.flatMap((orbital) =>
    [orbital.entity, ...(orbital.auxiliaryEntities ?? [])].flatMap((entity) => isEntityReferenceAny(entity) ? [] : [entity.name]));
}

type ContractAsk = <T>(schema: { parse(input: ReturnType<typeof JSON.parse>): T }, query: object) => T;

function contractAnswers(ask: ContractAsk) {
  return {
    findExternalInput(orbital: string, trait: string, event: string): ExternalInput | undefined {
      return ask(ExternalInputSchema.nullable(), { kind: 'findExternalInput', orbital, trait, event }) ?? undefined;
    },
    findInbound(name: string): { route: InboundRoute } | { answer: InboundAnswer } {
      return ask(InboundFoundSchema, { kind: 'findInbound', name });
    },
    inboundPayload(route: InboundRoute, delivery: InboundDelivery, credential: string | null | undefined): EventPayload {
      const headers = Object.fromEntries(Object.entries(delivery.headers).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]])));
      return ask(EventPayloadSchema, { kind: 'inboundPayload', route, headers, rawBody: delivery.rawBody, ...(typeof credential === 'string' ? { credential } : {}) });
    },
    inboundAnswer(route: InboundRoute, emitted: readonly { event: string; payload?: EventPayload }[], error: string | undefined): InboundAnswer {
      return ask(InboundAnswerSchema, { kind: 'inboundAnswer', route, emitted, ...(error !== undefined ? { error } : {}) });
    },
    credentialUnset(credential: string): InboundAnswer {
      return ask(InboundAnswerSchema, { kind: 'credentialUnset', credential });
    },
    dispatchFailed(message: string): InboundAnswer {
      return ask(InboundAnswerSchema, { kind: 'dispatchFailed', message });
    },
  };
}

/** The declared-contract answers of a host holding no program: the kernel's own answers on an empty kernel. */
export type ProgramlessContract = ReturnType<typeof contractAnswers>;

export class KernelEngine {
  private handle: KernelServerHandle;
  private readonly turns = new Map<number, Turn>();
  private tickRelayIntervalMs: number | undefined;
  private stateful = false;
  private messages: { locales: readonly string[]; catalogs: MessageCatalogs } = { locales: [], catalogs: {} };

  constructor(
    private readonly kernel: KernelModule,
    private readonly schemaJson: string,
    private readonly ports: KernelHostPorts,
    private readonly entityTypes: readonly string[] = [],
    forkedFrom?: KernelServerHandle,
    providedHandle?: KernelServerHandle,
    private readonly preserveProgramContext = false,
    private readonly lazyDir?: string,
  ) {
    installKernelEvaluator(kernel);
    this.ports = {
      ...ports,
      substrateMessage: (site, key, value): OsCompletionEvent | null => JSON.parse(kernel.osCompletionEvent(JSON.stringify({ ...site, emit: { success: site.emit.onMessage } }), key, JSON.stringify({ ok: value }))),
      substrateCompletion: (site, key, op, args, outcome): OsCompletionEvent | null => JSON.parse(kernel.substrateCompletionEvent(JSON.stringify(site), key, op, JSON.stringify(args), JSON.stringify(outcome))),
    };
    this.handle = providedHandle ?? forkedFrom?.fork() ?? this.openServer();
    this.declare();
  }

  /**
   * A kernel on the same program, registered once, holding none of this one's session: every trait at its initial
   * state, no rows the kernel held, its locales and mounted ticks kept. A stateless host serves each request a
   * fork (EXEC-DIST-5), `ports` answering it.
   */
  fork(ports: KernelHostPorts = this.ports): KernelEngine {
    const forked = new KernelEngine(this.kernel, this.schemaJson, ports, this.entityTypes, this.handle, undefined, this.preserveProgramContext, this.lazyDir);
    forked.messages = this.messages;
    return forked;
  }

  forkProgram(program: OrbitalSchema, ports: KernelHostPorts = this.ports): KernelEngine {
    const schemaJson = JSON.stringify(program);
    const entityTypes = [...new Set([
      ...this.entityTypes,
      ...declaredEntityTypes(program),
    ])];
    return new KernelEngine(this.kernel, schemaJson, ports, entityTypes, undefined, this.handle.forkProgram(schemaJson), true);
  }

  /** A server over the host's ports. */
  private openServer(): KernelServerHandle {
    return new this.kernel.Server(this.schemaJson, this.lazyDir);
  }

  private declare(): void {
    const handle = this.handle;
    declareCapabilities(this.ports.persistence, (entityType, queryJson, writeJson) => handle.setCapabilities(entityType, queryJson, writeJson), this.entityTypes);
  }

  /** The contract answers for a host with no program registered yet: the kernel's, asked with no program. */
  static withoutProgram(kernel: KernelModule): ProgramlessContract {
    return contractAnswers((schema, query) => schema.parse(JSON.parse(kernel.contractQueryWithoutProgram(JSON.stringify(query)))));
  }

  static open(kernel: KernelModule, schema: OrbitalSchema, ports: KernelHostPorts, lazyDir?: string): KernelEngine {
    return new KernelEngine(kernel, JSON.stringify(schema), ports, declaredEntityTypes(schema), undefined, undefined, false, lazyDir);
  }

  /** A fresh kernel on the same program: every trait back at its initial state. */
  reset(): void {
    const contextualHandle = this.preserveProgramContext ? this.handle.fork() : undefined;
    this.handle.free();
    this.handle = contextualHandle ?? this.openServer();
    this.declare();
    if (this.tickRelayIntervalMs !== undefined) this.handle.setTickRelayInterval(this.tickRelayIntervalMs);
    if (this.stateful) this.handle.setStateful(true);
    this.handle.setMessages(JSON.stringify(this.messages.locales), JSON.stringify(this.messages.catalogs));
    if (this.managedProgram !== undefined) this.handle.setManagedProgram(this.managedProgram);
  }

  private managedProgram: string | undefined;

  /** The program whose declared credentials this kernel's credential effects manage beside its own (a console's app). */
  setManagedProgram(program: OrbitalSchema): void {
    this.managedProgram = JSON.stringify(program);
    this.handle.setManagedProgram(this.managedProgram);
  }

  /** The program's declared locales and merged catalogs (a lazy page's behavior contributes its namespaced keys). */
  setMessages(locales: readonly string[], catalogs: MessageCatalogs): void {
    this.messages = { locales, catalogs };
    this.handle.setMessages(JSON.stringify(locales), JSON.stringify(catalogs));
  }

  /** `client` mounted `traits` of `orbital`: their mount-scoped ticks fire while any client holds them. A request derives this itself; this is for a mount made outside a request. */
  mountClient(client: string, orbital: string, traits: readonly string[]): void {
    this.handle.mountClient(client, orbital, JSON.stringify(traits));
  }

  unmountClient(client: string, orbital: string, traits: readonly string[]): void {
    this.handle.unmountClient(client, orbital, JSON.stringify(traits));
  }

  /** `client` is gone: everything it mounted is released. */
  releaseClient(client: string): void {
    this.handle.releaseClient(client);
  }

  /** This host holds the circuit state: the kernel takes a client's copy of it only on a delegated leg and refuses any other request carrying one. */
  setStateful(): void {
    this.stateful = true;
    this.handle.setStateful(true);
  }

  /** Whether the program declares any tick: the host runs its timer only then. */
  declaresTicks(): boolean {
    return this.handle.declaresTicks();
  }

  /** Queue a tick-stamped dispatch for the coalesced peer relay; the ms after which to flush when it opened a window. */
  relayTick(orbital: string, request: EventRequest): number | undefined {
    const window: number | null = JSON.parse(this.handle.relayTick(orbital, JSON.stringify(request)));
    return window ?? undefined;
  }

  /** The relay window's length in ms; the kernel's default is 50. */
  setTickRelayInterval(intervalMs: number): void {
    this.tickRelayIntervalMs = intervalMs;
    this.handle.setTickRelayInterval(intervalMs);
  }

  /** Every item queued since the window opened, in first-arrival order; the window closes. */
  flushTickRelay(): LiveBroadcastItem[] {
    return LiveBroadcastItemSchema.array().parse(JSON.parse(this.handle.flushTickRelay()));
  }

  /** One pass of the kernel's tick clock: the ticks due at monotonic `nowMs` that this server runs (`[background]` ticks, and those of a mounted trait), keyed by the orbital each `runTick` request is addressed to. */
  tickPass(nowMs: number): FiredByOrbital {
    return decodeDueTicks(this.handle.tickPass(nowMs));
  }

  /** Stop the kernel's tick clock; its phase is kept. */
  tickPause(): void {
    this.handle.tickPause();
  }

  /** Restart the kernel's tick clock; the paused span is never counted. */
  tickResume(): void {
    this.handle.tickResume();
  }

  tickPaused(): boolean {
    return this.handle.tickPaused();
  }

  /** What this host mounts when it starts: the kernel's boot mounts for the side it serves (EXEC-ENDPOINT-3). */
  bootMounts(side: 'server' | 'process'): MountSeed[] {
    return MountSeedSchema.array().parse(JSON.parse(this.handle.bootMounts(side)));
  }

  /** What mounts when a client opens `routePath` (EXEC-ENDPOINT-3). */
  routeMounts(routePath: string): MountSeed[] {
    return MountSeedSchema.array().parse(JSON.parse(this.handle.routeMounts(routePath)));
  }

  dispose(): void {
    this.handle.free();
  }

  private readonly answers = contractAnswers((schema, query) => this.contract(schema, query));

  private contract<T>(schema: { parse(input: ReturnType<typeof JSON.parse>): T }, query: object): T {
    return schema.parse(JSON.parse(this.handle.contractQuery(JSON.stringify(query))));
  }

  /** Every external input the program declares: what an outside client may send which trait. */
  externalInputs(): ExternalInput[] {
    return this.contract(ExternalInputSchema.array(), { kind: 'externalInputs' });
  }

  /** What the kernel holds of every trait of the program, in name order, and the browser-stored entities. */
  programSurface(): ProgramSurface {
    return this.contract(PROGRAM_SURFACE, { kind: 'programSurface' });
  }

  /** The entities a provider acting as the caller may read. */
  readableEntities(): string[] {
    return this.contract(NameListSchema, { kind: 'readableEntities' });
  }

  /** The declared input of `trait.event` in `orbital`, when there is one. */
  findExternalInput(orbital: string, trait: string, event: string): ExternalInput | undefined {
    return this.answers.findExternalInput(orbital, trait, event);
  }

  /** The declared input a `listens`-addressed event names from `caller`'s position (`EVENT`, `Trait.EVENT`, `Orbital.Trait.EVENT`), when there is one. */
  findInputByAddress(address: string, caller: { orbital: string; trait: string }): ExternalInput | undefined {
    return this.contract(ExternalInputSchema.nullable(), { kind: 'findInputByAddress', address, caller }) ?? undefined;
  }

  /** A declared payload as the JSON Schema of one object: what a tool-calling model fills. */
  payloadJsonSchema(fields: readonly PayloadField[]): JsonSchema {
    return this.contract(PayloadJsonSchemaSchema, { kind: 'payloadSchemaToJsonSchema', fields });
  }

  /** The ways `value` misses the declared payload `fields`. */
  payloadIssues(fields: readonly PayloadField[], value: EventPayload): PayloadIssue[] {
    return this.contract(PayloadIssueSchema.array(), { kind: 'payloadIssues', fields, value });
  }

  /** The route a hook name is delivered to, or the answer to write for a hook the program does not serve. */
  findInbound(name: string): { route: InboundRoute } | { answer: InboundAnswer } {
    return this.answers.findInbound(name);
  }

  /** The trait that handles `event` as an inbound hook in `orbital`, with the refusal message, when a client-facing request names it. */
  inboundOnly(orbital: string, trait: string | undefined, event: string): { trait: string; message: string } | undefined {
    return this.contract(InboundOnlySchema, { kind: 'inboundOnly', orbital, ...(trait !== undefined ? { trait } : {}), event }) ?? undefined;
  }

  /** The payload an inbound event is delivered with. */
  inboundPayload(route: InboundRoute, delivery: InboundDelivery, credential: string | null | undefined): EventPayload {
    return this.answers.inboundPayload(route, delivery, credential);
  }

  /** The HTTP answer a finished dispatch produced for `route`. */
  inboundAnswer(route: InboundRoute, emitted: readonly { event: string; payload?: EventPayload }[], error: string | undefined): InboundAnswer {
    return this.answers.inboundAnswer(route, emitted, error);
  }

  /** The answer for a route whose credential the host holds no value for. */
  credentialUnset(credential: string): InboundAnswer {
    return this.answers.credentialUnset(credential);
  }

  /** The answer for a delivery whose dispatch failed. */
  dispatchFailed(message: string): InboundAnswer {
    return this.answers.dispatchFailed(message);
  }

  /** The name of the program's `[identity]` entity, when it declares one. */
  identityEntity(): string | undefined {
    return this.contract(OptionalNameSchema, { kind: 'identityEntity' }) ?? undefined;
  }

  /** The orbital that declares `entity` inline. */
  entityOwnerOrbital(entity: string): string | undefined {
    return this.contract(OptionalNameSchema, { kind: 'entityOwner', entity }) ?? undefined;
  }

  /** `rows` of `entity` as `user` reads them: narrowed by the entity's declared `@read`, which the kernel evaluates with `@user` bound to the viewer. */
  readRows(entity: string, rows: readonly EntityRow[], user: UserContext | undefined): EntityRow[] {
    return this.contract(EntityRowSchema.array(), { kind: 'readRows', entity, rows, viewer: user ?? null });
  }

  liveItemDelivered(item: object, viewer: object | null, clientId?: string): boolean {
    return this.handle.liveItemDelivered(JSON.stringify(item), JSON.stringify(viewer), clientId);
  }

  /** `OsGrants::allows` over the grants of the program this kernel runs. */
  osAllows(requirementJson: string): boolean {
    return this.handle.osAllows(requirementJson);
  }

  /** Whether `url`'s origin is declared in the program's `egress` (the kernel's rule). */
  egressAllows(url: string): boolean {
    return this.handle.egressAllows(url);
  }

  /** Place the program's anchored grants and arguments under the host's anchors. */
  setOsAnchors(anchorsJson: string): string {
    return this.handle.setOsAnchors(anchorsJson);
  }

  /** An `os/` call's arguments with its anchored parts resolved under the host's anchors. */
  osResolveArgs(op: string, argsJson: string): string {
    return this.handle.osResolveArgs(op, argsJson);
  }

  tlsComplete(key: string, outcomeJson: string): string {
    return this.handle.tlsComplete(key, outcomeJson);
  }

  /** A live stream of `client`'s session opened (EXEC-DIST-9); the id closes it. */
  openSessionStream(client: string): number {
    return this.handle.openSessionStream(client);
  }

  /** The live stream `id` dropped: the kernel frees the session once its streams have all dropped and it is quiet. */
  closeSessionStream(id: number): boolean {
    return this.handle.closeSessionStream(id);
  }

  /** The current state of a trait instance, `''` when it has none. */
  stateOf(traitName: string, entityId?: string): string {
    return this.handle.getState(traitName, entityId);
  }

  /**
   * `reference` resolved for `scope.user` against the host-answered store (EXEC-RENDER-3): the rows that still
   * match its query and the viewer's `@read` in the reference's order, a missing or hidden row omitted, and `total`
   * re-counted (a `total: none` reference is not re-counted: the total is the resolved window). Each read the
   * kernel makes is answered here, as in `evaluate`.
   */
  async resolveRows(reference: RowSetRef, scope: KernelAnswerScope): Promise<RowQueryPage> {
    const handle = this.handle;
    let progress = decodeResolveProgress(handle.resolveRows(JSON.stringify(reference), JSON.stringify(scope.user ?? null)));
    while (progress.status === 'await') {
      const { flight, requests } = progress;
      let replies: IoReplyWire[];
      try {
        replies = await Promise.all(
          requests.map(async (pending) => ({ id: pending.id, answer: await answerRequest(this.ports, pending.request, scope) })),
        );
      } catch (error) {
        handle.abandon(flight);
        throw error;
      }
      progress = decodeResolveProgress(handle.resumeResolve(flight, JSON.stringify(replies)));
    }
    return { rows: progress.rows, total: progress.total };
  }

  /**
   * Run `request` against `orbital`. The kernel orders every start and every resumption (EXEC-CONC-2): while another
   * dispatch holds the lane it answers `queued` and runs the work itself once the lane frees; this host only answers
   * what each dispatch asks.
   */
  async evaluate(orbital: string, request: EventRequest, scope: KernelAnswerScope): Promise<EventResponse> {
    const handle = this.handle;
    const streams = scope.onStream !== undefined;
    let running = await this.ran(handle.start(orbital, JSON.stringify(request)), streams);
    try {
      while (running.progress.status === 'await') {
        const { flight, requests } = running.progress;
        const assertReentry = (): void => {
          if (handle.holdsLane(flight)) throw new LaneHeldByParkedDispatch(flight, request.event);
        };
        let replies: IoReplyWire[];
        try {
          replies = await Promise.all(
            requests.map(async (pending) => ({ id: pending.id, answer: await answerRequest(this.ports, pending.request, { ...scope, assertReentry }) })),
          );
        } catch (error) {
          handle.abandon(flight);
          throw error;
        }
        running = await this.ran(handle.resume(flight, JSON.stringify(replies)), streams);
      }
    } finally {
      this.runQueued();
    }
    if (scope.onStream !== undefined && running.stream !== undefined) {
      const items: KernelStreamItem[] = JSON.parse(running.stream);
      for (const item of items) scope.onStream(item);
      scope.onStream({ type: 'complete', data: running.progress.response, timestamp: Date.now() });
    }
    return running.progress.response;
  }

  /** The kernel's answer to a start or resume, once it has run: at once, or when the kernel takes it from its queue. */
  private ran(json: string, streams: boolean): Running | Promise<Running> {
    const progress = decodeProgress(json);
    if (progress.status !== 'queued') return this.running(progress, streams);
    const turn = new Promise<Running>((ran, failed) => {
      this.turns.set(progress.ticket, { streams, ran, failed });
    });
    // A waiter never relies on one holder's `finally` alone: if the lane is already free, its turn runs now.
    queueMicrotask(() => this.runQueued());
    return turn;
  }

  private running(progress: Exclude<ServerProgressWire, { status: 'queued' }>, streams: boolean): Running {
    return { progress, stream: streams && progress.status === 'done' ? this.handle.dispatchStream() : undefined };
  }

  /** Run each piece of queued work that can run now, in the kernel's order, handing each to the dispatch it continues. */
  private runQueued(): void {
    for (;;) {
      const next = decodeNext(this.handle.next());
      if (next === null) return;
      const turn = this.turns.get(next.ticket);
      if (turn === undefined) throw new Error(`kernel wire: the kernel ran ticket ${next.ticket}, which nothing waits on`);
      this.turns.delete(next.ticket);
      if (next.outcome === 'failed') {
        turn.failed(new Error(next.error));
        continue;
      }
      if (next.progress.status === 'queued') throw new Error('kernel wire: the kernel queued work it was running');
      turn.ran(this.running(next.progress, turn.streams));
    }
  }
}

/** What `evaluateOrbitalEvent` needs to run a request on the kernel instead of the JS composition. */
export interface KernelEvaluation {
  engine: KernelEngine;
  /** The orbital the request is addressed to. */
  orbital: string;
  onStream?: (item: EventStreamItem) => void;
}

/**
 * The request as the kernel takes it: the viewer and locale the host resolved, the `_targetTrait` sidecar
 * promoted to `targetTrait`, and the `_activeTraits` sidecar dropped (the kernel's mounted set is explicit,
 * not carried per request).
 */
export function kernelRequest(request: EventRequest, user: UserContext | undefined, locale: string | undefined): EventRequest {
  const { _activeTraits: _dropped, _targetTrait: sidecarTarget, ...rest }: EventPayload = request.payload ?? {};
  const payload: EventPayload = rest;
  const target = request.targetTrait ?? (typeof sidecarTarget === 'string' ? sidecarTarget : undefined);
  const { payload: _payload, ...others } = request;
  return {
    ...others,
    ...(request.payload !== undefined ? { payload } : {}),
    ...(target !== undefined ? { targetTrait: target } : {}),
    ...(user !== undefined ? { user } : {}),
    ...(locale !== undefined ? { locale } : {}),
  };
}

/** The requesting client stamped on each emit, as the JS host's emit stamp does: a client-driven cascade is told apart from a headless one. */
function withOriginClient(response: EventResponse, clientId: string | undefined): EventResponse {
  if (clientId === undefined) return response;
  return {
    ...response,
    emittedEvents: response.emittedEvents.map((emitted) =>
      emitted.source === undefined ? emitted : { ...emitted, source: { ...emitted.source, originClientId: emitted.source.originClientId ?? clientId } }),
  };
}

export async function evaluateOnKernel(
  kernel: KernelEvaluation,
  request: EventRequest,
  user: UserContext | undefined,
  locale: string | undefined,
): Promise<EventResponse> {
  return withOriginClient(await kernel.engine.evaluate(kernel.orbital, kernelRequest(request, user, locale), {
    orbital: kernel.orbital,
    ...(user !== undefined ? { user } : {}),
    ...(request.clientId !== undefined ? { originClientId: request.clientId } : {}),
    ...(locale !== undefined ? { locale } : {}),
    ...(request.entityId !== undefined ? { entityId: request.entityId } : {}),
    ...(kernel.onStream !== undefined ? { onStream: (item: EventStreamItem): void => {
      if (item.type === 'event' && item.data.source !== undefined && request.clientId !== undefined) {
        kernel.onStream?.({ ...item, data: { ...item.data, source: { ...item.data.source, originClientId: item.data.source.originClientId ?? request.clientId } } });
      } else if (item.type === 'complete') {
        kernel.onStream?.({ ...item, data: withOriginClient(item.data, request.clientId) });
      } else kernel.onStream?.(item);
    } } : {}),
  }), request.clientId);
}
