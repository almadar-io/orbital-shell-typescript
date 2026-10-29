/**
 * The kernel-backed implementation of `evaluateOrbitalEvent` / `OrbitalServerRuntime`: the Rust kernel
 * (`@almadar/kernel`, WebAssembly) decides every execution step; this host answers the I/O it asks for
 * and nothing else. The continuation of a stopped dispatch never leaves the wasm instance.
 */
import { installKernelEvaluator, isEntityReferenceAny, MountSeedSchema, type MountSeed, type EventPayload, type EventStreamItem, type MessageCatalogs, type OrbitalEventRequest, type OrbitalEventResponse, type OrbitalSchema, type RowQueryPage, type RowSetRef, type UserContext } from '@almadar/core';
import { LaneHeldByParkedDispatch } from './lane.js';
import { decodeNext, decodeProgress, decodeResolveProgress } from './decode.js';
import { answerRequest, declareCapabilities, type KernelAnswerScope, type KernelHostPorts } from './host.js';
import type { OsCompletionEvent } from './os-port.js';
import type { IoReplyWire, KernelModule, KernelServerHandle, ServerProgressWire } from './wire.js';

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

function declaredEntityTypes(schema: OrbitalSchema): string[] {
  return schema.orbitals.flatMap((orbital) =>
    [orbital.entity, ...(orbital.auxiliaryEntities ?? [])].flatMap((entity) => isEntityReferenceAny(entity) ? [] : [entity.name]));
}

export class KernelEngine {
  private handle: KernelServerHandle;
  private readonly turns = new Map<number, Turn>();
  private tickMount: string[] = [];
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
    forked.tickMount = this.tickMount;
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

  static open(kernel: KernelModule, schema: OrbitalSchema, ports: KernelHostPorts, lazyDir?: string): KernelEngine {
    return new KernelEngine(kernel, JSON.stringify(schema), ports, declaredEntityTypes(schema), undefined, undefined, false, lazyDir);
  }

  /** A fresh kernel on the same program: every trait back at its initial state. */
  reset(): void {
    const contextualHandle = this.preserveProgramContext ? this.handle.fork() : undefined;
    this.handle.free();
    this.handle = contextualHandle ?? this.openServer();
    this.declare();
    this.handle.setTickMount(JSON.stringify(this.tickMount));
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

  /** The traits some client has mounted: a tick that is not `[background]` fires only for these. */
  setTickMount(traits: string[]): void {
    this.tickMount = traits;
    this.handle.setTickMount(JSON.stringify(traits));
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

  liveItemDelivered(item: object, viewer: object | null, clientId?: string): boolean {
    return this.handle.liveItemDelivered(JSON.stringify(item), JSON.stringify(viewer), clientId);
  }

  /** `OsGrants::allows` over the grants of the program this kernel runs. */
  osAllows(requirementJson: string): boolean {
    return this.handle.osAllows(requirementJson);
  }

  /** Place the program's anchored grants and arguments under the host's anchors. */
  setOsAnchors(anchorsJson: string): string {
    return this.handle.setOsAnchors(anchorsJson);
  }

  /** An `os/` call's arguments with its anchored parts resolved under the host's anchors. */
  osResolveArgs(op: string, argsJson: string): string {
    return this.handle.osResolveArgs(op, argsJson);
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
  async evaluate(orbital: string, request: OrbitalEventRequest, scope: KernelAnswerScope): Promise<OrbitalEventResponse> {
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
export function kernelRequest(request: OrbitalEventRequest, user: UserContext | undefined, locale: string | undefined): OrbitalEventRequest {
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
function withOriginClient(response: OrbitalEventResponse, clientId: string | undefined): OrbitalEventResponse {
  if (clientId === undefined) return response;
  return {
    ...response,
    emittedEvents: response.emittedEvents.map((emitted) =>
      emitted.source === undefined ? emitted : { ...emitted, source: { ...emitted.source, originClientId: emitted.source.originClientId ?? clientId } }),
  };
}

export async function evaluateOnKernel(
  kernel: KernelEvaluation,
  request: OrbitalEventRequest,
  user: UserContext | undefined,
  locale: string | undefined,
): Promise<OrbitalEventResponse> {
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
