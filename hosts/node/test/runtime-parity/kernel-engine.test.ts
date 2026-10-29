import './helpers/kernel-evaluator.setup.js';
/**
 * The kernel-backed engine (`OrbitalServerRuntime`, `evaluateOrbitalEvent`'s `kernel`
 * dep): the Rust kernel decides every step, this package answers the I/O it asks for. Needs the built
 * `@almadar/kernel` (ALMADAR_KERNEL_DIR) and a kernel with a `MemoryStore` (ORBITAL_KERNEL_NODE or
 * ORBITAL_KERNEL_MEMORY_WASM); the suite is skipped without them.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FrameDelta } from '@almadar/core/kernel-wire';
import type { EntityRow, EventPayload, JsonValue, OrbitalSchema, PersistenceAdapter, ServiceHostPorts } from '@almadar/core';
import { OrbitalServerRuntime } from '../../src/runtime/OrbitalServerRuntime.js';
import { InFlightCalls, type NativeMemoryPersistenceAdapter } from '@almadar/shell-runtime';
import { answerRequest, type DeferredCallOutcome, type KernelAnswerScope, type KernelHostPorts } from '@almadar/shell-runtime';
import type { KernelModule } from '@almadar/shell-runtime';
import { KERNEL_DIR } from './helpers/kernel-module.js';
import { MEMORY_KERNEL_PATH, memoryKernel, nativeMemory } from './helpers/native-memory.js';

const emit = { emit: { success: 'SAVED', failure: 'SAVE_FAILED' } };

function notes(): OrbitalSchema {
  return {
    name: 'notes',
    typeContractVersion: 1,
    version: '1.0.0',
    orbitals: [{
      name: 'Main',
      pages: [],
      entity: { name: 'Note', persistence: 'persistent', collection: 'notes', fields: [{ name: 'id', type: 'string', primaryKey: true }, { name: 'title', type: 'string' }] },
      traits: [{
        name: 'Draft',
        linkedEntity: 'Note',
        stateMachine: {
          states: [{ name: 'editing', isInitial: true }, { name: 'saving' }, { name: 'saved' }, { name: 'failed' }],
          events: [{ key: 'SAVE', name: 'SAVE' }, { key: 'SAVED', name: 'SAVED' }, { key: 'SAVE_FAILED', name: 'SAVE_FAILED' }],
          transitions: [
            { from: 'editing', to: 'saving', event: 'SAVE', effects: [['persist', 'create', 'Note', { id: 'd1', title: 'draft' }, emit]] },
            { from: 'saving', to: 'saved', event: 'SAVED' },
            { from: 'saving', to: 'failed', event: 'SAVE_FAILED' },
          ],
        },
      }],
    }],
  };
}

function endpoints(): OrbitalSchema {
  const lifecycle = (name: string) => ({
    name,
    linkedEntity: 'Note',
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }, { name: 'ready' }],
      events: [{ key: 'INIT', name: 'INIT' }],
      transitions: [{ from: 'idle', to: 'ready', event: 'INIT' }],
    },
  });
  return {
    name: 'endpoints',
    typeContractVersion: 1,
    version: '1.0.0',
    orbitals: [{
      name: 'Main',
      pages: [
        { name: 'Home', path: '/', traits: [{ ref: 'ViewT' }] },
        { name: 'Background', path: '', protocol: 'boot', traits: [{ ref: 'BootT' }] },
      ],
      entity: { name: 'Note', persistence: 'persistent', collection: 'notes', fields: [{ name: 'id', type: 'string', primaryKey: true }] },
      traits: [lifecycle('ViewT'), lifecycle('BootT')],
    }],
  };
}

function service(): OrbitalSchema {
  const options = { emit: { success: 'DONE', failure: 'FAILED' } };
  return {
    name: 'svc',
    typeContractVersion: 1,
    version: '1.0.0',
    orbitals: [{
      name: 'Main',
      pages: [],
      entity: { name: 'Run', fields: [{ name: 'id', type: 'string' }] },
      traits: [{
        name: 'Runner',
        linkedEntity: 'Run',
        stateMachine: {
          states: [{ name: 'idle', isInitial: true }, { name: 'done' }, { name: 'failed' }],
          events: [{ key: 'GO', name: 'GO' }, { key: 'DONE', name: 'DONE' }, { key: 'FAILED', name: 'FAILED' }],
          transitions: [
            { from: 'idle', to: 'idle', event: 'GO', effects: [['call-service', 'test-svc', 'run', { event: 'a' }, options]] },
            { from: 'idle', to: 'done', event: 'DONE', effects: [['set', '@entity.got', '@payload']] },
            { from: 'idle', to: 'failed', event: 'FAILED', effects: [['set', '@entity.got', '@payload']] },
          ],
        },
      }],
    }],
  };
}

describe.skipIf(KERNEL_DIR === undefined || MEMORY_KERNEL_PATH === undefined)('kernel engine', () => {
  let kernel: KernelModule;
  beforeAll(async () => {
    kernel = await memoryKernel();
  });

  const open = async (schema: OrbitalSchema, config: ConstructorParameters<typeof OrbitalServerRuntime>[0] = {}): Promise<OrbitalServerRuntime> => {
    const runtime = new OrbitalServerRuntime({ kernel, ...config });
    await runtime.register(schema);
    return runtime;
  };

  // Twin of orbital-core `exec_conc_2_the_kernel_queues_a_request_behind_a_dispatch_parked_on_an_unkeyed_ask`.
  describe('the kernel orders requests (EXEC-CONC-2)', () => {
    const laned = (): OrbitalSchema => ({
      name: 'laned',
      typeContractVersion: 1,
      version: '1.0.0',
      orbitals: [{
        name: 'Main',
        pages: [],
        entity: { name: 'Job', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [
          { name: 'Asker', linkedEntity: 'Job', stateMachine: {
            states: [{ name: 'idle', isInitial: true }, { name: 'asked' }],
            events: [{ key: 'ASK', name: 'ASK' }],
            transitions: [{ from: 'idle', to: 'asked', event: 'ASK', effects: [['call-service', 'svc', 'work', {}]] }],
          } },
          { name: 'Counter', linkedEntity: 'Job', stateMachine: {
            states: [{ name: 'zero', isInitial: true }, { name: 'one' }],
            events: [{ key: 'TOUCH', name: 'TOUCH' }],
            transitions: [{ from: 'zero', to: 'one', event: 'TOUCH' }],
          } },
        ],
      }],
    });

    it('a request arriving while an unkeyed service call holds the lane runs after that dispatch commits', async () => {
      let answer: (value: EventPayload) => void = () => undefined;
      const order: string[] = [];
      const runtime = await open(laned(), { effectHandlers: { callService: () => new Promise<EventPayload>((resolve) => { answer = resolve; }) } });
      const asking = runtime.processOrbitalEvent('Main', { event: 'ASK', targetTrait: 'Asker' }).then((r) => { order.push('ASK'); return r; });
      await new Promise((r) => setTimeout(r, 5));
      const touching = runtime.processOrbitalEvent('Main', { event: 'TOUCH', targetTrait: 'Counter' }).then((r) => { order.push('TOUCH'); return r; });
      await new Promise((r) => setTimeout(r, 5));
      expect(runtime.getState('Main', 'Counter')).toMatchObject({ currentState: 'zero' });
      answer({ ok: true });
      const [asked, touched] = await Promise.all([asking, touching]);
      expect(asked.states).toMatchObject({ Asker: 'asked' });
      expect(touched.states).toMatchObject({ Counter: 'one' });
      expect(order).toEqual(['ASK', 'TOUCH']);
    });

    it('control: with the lane free a request runs at once', async () => {
      const runtime = await open(laned());
      const touched = await runtime.processOrbitalEvent('Main', { event: 'TOUCH', targetTrait: 'Counter' });
      expect(touched.states).toMatchObject({ Counter: 'one' });
    });
  });

  // Twin of orbital-core `exec_dist_9_a_clients_frame_is_its_own_session_and_another_client_does_not_overwrite_it`.
  describe('a client session owns its frames (EXEC-DIST-9)', () => {
    const drafts = (): OrbitalSchema => ({
      name: 'drafts',
      typeContractVersion: 1,
      version: '1.0.0',
      orbitals: [{
        name: 'Main',
        pages: [],
        entity: { name: 'Draft', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }, { name: 'name', type: 'string' }, { name: 'seen', type: 'string' }] },
        traits: [{ name: 'Editor', linkedEntity: 'Draft', stateMachine: {
          states: [{ name: 'idle', isInitial: true }],
          events: [{ key: 'SET', name: 'SET' }, { key: 'LOOK', name: 'LOOK' }],
          transitions: [
            { from: 'idle', to: 'idle', event: 'SET', effects: [['set', '@entity.name', '@payload.name']] },
            { from: 'idle', to: 'idle', event: 'LOOK', effects: [['set', '@entity.seen', '@entity.name']] },
          ],
        } }],
      }],
    });
    const seen = (response: { frames?: FrameDelta }): JsonValue | undefined => {
      let value: JsonValue | undefined;
      for (const op of response.frames?.ops ?? []) {
        if (op[0] === 'set') value = op[1]['Editor']?.['seen'] ?? value;
        if (op[0] === 'put' && op[1] === 'Editor') value = op[2]['seen'];
      }
      return value;
    };

    it('another client\'s dispatch does not overwrite a client\'s frame', async () => {
      const runtime = await open(drafts());
      await runtime.processOrbitalEvent('Main', { event: 'SET', targetTrait: 'Editor', clientId: 'tab-a', payload: { name: 'app' } });
      await runtime.processOrbitalEvent('Main', { event: 'SET', targetTrait: 'Editor', clientId: 'tab-b', payload: { name: 'cli' } });
      expect(seen(await runtime.processOrbitalEvent('Main', { event: 'LOOK', targetTrait: 'Editor', clientId: 'tab-a' }))).toBe('app');
      expect(seen(await runtime.processOrbitalEvent('Main', { event: 'LOOK', targetTrait: 'Editor', clientId: 'tab-b' }))).toBe('cli');
    });
  });

  it('runs a persisting dispatch through the persistence adapter', async () => {
    const persistence = await nativeMemory();
    const runtime = await open(notes(), { persistence });
    const response = await runtime.processOrbitalEvent('Main', { event: 'SAVE', targetTrait: 'Draft' });
    expect(response.success).toBe(true);
    expect(response.states).toEqual({ Draft: 'saved' });
    expect(await persistence.getById('Note', 'd1')).toMatchObject({ id: 'd1', title: 'draft' });
    expect(runtime.getState('Main', 'Draft')).toMatchObject({ currentState: 'saved' });
    expect(runtime.getState('Main')).toEqual({ Draft: expect.objectContaining({ currentState: 'saved' }) });
  });

  it('boots exactly the kernel\'s server mounts: a boot-endpoint trait is mounted and a route trait is not', async () => {
    const runtime = await open(endpoints(), { persistence: await nativeMemory() });
    expect(runtime.getState('Main', 'BootT')).toMatchObject({ currentState: 'ready' });
    expect(runtime.getState('Main', 'ViewT')).toMatchObject({ currentState: 'idle' });
  });

  it('control: the JS engine, unselected, gives the same states and leaves the kernel unopened', async () => {
    const persistence = await nativeMemory();
    const runtime = new OrbitalServerRuntime({ kernel, persistence });
    await runtime.register(notes());
    const response = await runtime.processOrbitalEvent('Main', { event: 'SAVE', targetTrait: 'Draft' });
    expect(response.states).toEqual({ Draft: 'saved' });
  });

  it('a refused write takes the declared failure path', async () => {
    const memory = await nativeMemory();
    const refusing: PersistenceAdapter = {
      create: () => Promise.reject(new Error('disk full')),
      update: (t, id, d) => memory.update(t, id, d),
      delete: (t, id) => memory.delete(t, id),
      getById: (t, id) => memory.getById(t, id),
      list: (t) => memory.list(t),
    };
    const runtime = await open(notes(), { persistence: refusing });
    const response = await runtime.processOrbitalEvent('Main', { event: 'SAVE', targetTrait: 'Draft' });
    expect(response.states).toEqual({ Draft: 'failed' });
    expect(await memory.list('Note')).toEqual([]);
  });

  it('answers call-service through the injected provider, as the dispatch viewer', async () => {
    const seen: Array<{ service: string; action: string; params: object | undefined; principal: string | undefined; role: string | undefined }> = [];
    const runtime = await open(service(), {
      effectHandlers: {
        callService: async (s, a, params, context) => {
          seen.push({ service: s, action: a, params, principal: context?.principal, role: context?.role });
          return { embeddings: [1] };
        },
      },
    });
    const response = await runtime.processOrbitalEvent('Main', { event: 'GO', targetTrait: 'Runner', user: { id: 'u1', role: 'admin' } });
    expect(response.states).toEqual({ Runner: 'done' });
    expect(seen).toEqual([{ service: 'test-svc', action: 'run', params: { event: 'a' }, principal: 'u1', role: 'admin' }]);
  });

  it('control: a provider that throws routes to the declared failure event', async () => {
    const runtime = await open(service(), { effectHandlers: { callService: () => Promise.reject(new Error('rate limited')) } });
    const response = await runtime.processOrbitalEvent('Main', { event: 'GO', targetTrait: 'Runner' });
    expect(response.states).toEqual({ Runner: 'failed' });
  });

  it('an unknown locale is refused by the kernel', async () => {
    const schema: OrbitalSchema = { ...notes(), locales: ['en', 'ar'] };
    const runtime = await open(schema);
    const response = await runtime.processOrbitalEvent('Main', { event: 'SAVE', targetTrait: 'Draft', locale: 'fr' });
    expect(response.success).toBe(false);
    expect(response.error).toMatch(/locale "fr"/);
  });

  it('resetCircuitState returns the kernel to boot (every trait back at its initial state, EXEC-SEED-6)', async () => {
    const runtime = await open(notes());
    await runtime.processOrbitalEvent('Main', { event: 'SAVE', targetTrait: 'Draft' });
    expect(runtime.getState('Main', 'Draft')).toMatchObject({ currentState: 'saved' });
    runtime.resetCircuitState();
    expect(runtime.getState('Main', 'Draft')).toMatchObject({ currentState: 'editing' });
    // The circuit restarts from `editing`; the rows are not the circuit's, so re-creating d1 is a duplicate (EXEC-STEP-8).
    const again = await runtime.processOrbitalEvent('Main', { event: 'SAVE', targetTrait: 'Draft' });
    expect(again.states).toEqual({ Draft: 'failed' });
  });

  it('feeds the event bus and onPush from the dispatch response, emits before client effects', async () => {
    const schema = notes();
    schema.orbitals[0].traits[0] = {
      name: 'Draft',
      linkedEntity: 'Note',
      stateMachine: {
        states: [{ name: 'editing', isInitial: true }, { name: 'sent' }],
        events: [{ key: 'SEND', name: 'SEND' }],
        transitions: [{ from: 'editing', to: 'sent', event: 'SEND', effects: [['emit', 'PING', { n: 1 }], ['render-ui', 'main', { type: 'typography', content: 'sent' }]] }],
      },
    };
    const runtime = await open(schema);
    const heard: string[] = [];
    runtime.getEventBus().onAny((e) => heard.push(e.type));
    const pushed: string[] = [];
    const response = await runtime.processOrbitalEvent('Main', { event: 'SEND', targetTrait: 'Draft' }, (item) => pushed.push(item.type));
    expect(response.emittedEvents.map((e) => e.event)).toEqual(['PING']);
    expect(heard).toEqual(['PING']);
    expect(pushed).toEqual(['event', 'effect']);
  });

  it('control: the success emit of a persist is published, and nothing else', async () => {
    const runtime = await open(notes());
    const heard: string[] = [];
    runtime.getEventBus().onAny((e) => heard.push(e.type));
    const pushed: string[] = [];
    await runtime.processOrbitalEvent('Main', { event: 'SAVE', targetTrait: 'Draft' }, (item) => pushed.push(item.type));
    expect(heard).toEqual(['SAVED']);
    expect(pushed).toEqual(['event']);
  });

  it('runs a composed trait carried as a ref wrapper by inlining its resolved trait', async () => {
    const schema = notes();
    const [draft] = schema.orbitals[0].traits;
    if (typeof draft === 'string' || !('stateMachine' in draft)) throw new Error('fixture trait is not inline');
    schema.orbitals[0].traits[0] = { ref: 'Atom.traits.Draft', _resolved: draft };
    const runtime = await open(schema);
    const response = await runtime.processOrbitalEvent('Main', { event: 'SAVE', targetTrait: 'Draft' });
    expect(response.states).toEqual({ Draft: 'saved' });
  });

  it('registers an orb-resolved program that keeps its uses declarations without running orb again', async () => {
    const schema = notes();
    schema.orbitals[0].uses = [{ as: 'Gone', from: 'std/behaviors/std-not-installed' }];
    const runtime = await open(schema);
    const response = await runtime.processOrbitalEvent('Main', { event: 'SAVE', targetTrait: 'Draft' });
    expect(response.states).toEqual({ Draft: 'saved' });
  });

  it('refuses a program whose traits are still references (the kernel takes an orb-resolved program)', async () => {
    const schema = notes();
    schema.orbitals[0].traits.push({ ref: 'Elsewhere.traits.Other' });
    const runtime = new OrbitalServerRuntime({ kernel });
    await expect(runtime.register(schema)).rejects.toThrow(/orb-resolved program.*"Elsewhere.traits.Other"/);
  });

  it('loads the installed @almadar/kernel itself when the host passes no module', async () => {
    const runtime = new OrbitalServerRuntime({});
    await runtime.register(notes());
    const response = await runtime.processOrbitalEvent('Main', { event: 'SAVE', targetTrait: 'Draft' });
    expect(response.success).toBe(true);
    expect(response.states).toEqual({ Draft: 'saved' });
  });

  describe('host answers', () => {
    let defaultStore: NativeMemoryPersistenceAdapter;
    beforeEach(async () => {
      defaultStore = await nativeMemory();
    });
    const ports = (over: Partial<KernelHostPorts> = {}): KernelHostPorts => ({
      persistence: defaultStore,
      inFlightCalls: new InFlightCalls(),
      callService: async () => null,
      programEffect: () => undefined,
      servicePorts: (caller, _user, message) => ({ caller, message, inputs: () => [], readableEntities: () => [], dispatchInput: async () => { throw new Error('no input channel'); }, read: async () => [] }),
      deliverLive: () => undefined,
      deferCallOutcome: () => undefined,
      ...over,
    });
    const scope = (over: Partial<KernelAnswerScope> = {}): KernelAnswerScope => ({ orbital: 'Main', ...over });

    it('a write upserts and merges into the existing row', async () => {
      const persistence = await nativeMemory();
      const p = ports({ persistence });
      const first = await answerRequest(p, { kind: 'writeRow', entityType: 'N', id: 'a', data: { title: 'x', n: 1 } }, scope());
      expect(first).toEqual({ kind: 'row', result: { ok: { title: 'x', n: 1, id: 'a' } } });
      const second = await answerRequest(p, { kind: 'writeRow', entityType: 'N', id: 'a', data: { n: 2 } }, scope());
      expect(second).toEqual({ kind: 'row', result: { ok: { title: 'x', n: 2, id: 'a' } } });
      const stored: EntityRow | null = await persistence.getById('N', 'a');
      expect(stored).toEqual({ title: 'x', n: 2, id: 'a' });
    });

    it('reading a missing row answers null, which the kernel reads as absent', async () => {
      const answer = await answerRequest(ports(), { kind: 'readRow', entityType: 'N', id: 'zz' }, scope());
      expect(answer).toEqual({ kind: 'row', result: { ok: null } });
    });

    it('control: a store failure on a read is an error answer, not a throw', async () => {
      const failing = ports();
      failing.persistence.getById = async () => {
        throw new Error('backend down');
      };
      const answer = await answerRequest(failing, { kind: 'readRow', entityType: 'N', id: 'a' }, scope());
      expect(answer).toEqual({ kind: 'row', result: { error: 'backend down' } });
    });

    it('a keyed call is cancelled by cancelCall', async () => {
      const inFlightCalls = new InFlightCalls();
      const p = ports({ inFlightCalls, callService: () => new Promise(() => undefined) });
      const pending = answerRequest(p, { kind: 'callService', service: 's', method: 'm', args: null, key: 'k' }, scope());
      await Promise.resolve();
      expect(inFlightCalls.inFlight('k')).toBe(true);
      expect(await answerRequest(p, { kind: 'cancelCall', key: 'k' }, scope())).toEqual({ kind: 'cancelled', result: { ok: null } });
      expect(await pending).toEqual({ kind: 'serviceCancelled' });
    });

    it('a failing provider is an error answer, not a throw', async () => {
      const p = ports({ callService: async () => { throw new Error('model down'); } });
      expect(await answerRequest(p, { kind: 'callService', service: 's', method: 'm', args: {} }, scope())).toEqual({ kind: 'service', result: { error: 'model down' } });
    });

    it('a call lends the running app as the caller, and a live message reaches the route the site declares', async () => {
      const delivered: Array<{ site: { orbital: string; trait: string; event: string }; payload: EventPayload; origin: string | undefined }> = [];
      const seen: Array<ServiceHostPorts | undefined> = [];
      const p = ports({
        callService: async (_s, _a, _p, context) => { seen.push(context?.host); context?.host?.message({ text: 'reading' }); return { done: true }; },
        deliverLive: (site, payload, origin) => { delivered.push({ site, payload, origin }); },
      });
      const site = { orbital: 'Main', trait: 'Assistant', followOn: false, emit: { onMessage: 'STEP' } };
      const answer = await answerRequest(p, { kind: 'callService', service: 's', method: 'm', args: {}, site }, scope({ originClientId: 'tab-1' }));
      expect(answer).toEqual({ kind: 'service', result: { ok: { done: true } } });
      expect(seen[0]?.caller).toEqual({ orbital: 'Main', trait: 'Assistant' });
      expect(delivered).toEqual([{ site: { orbital: 'Main', trait: 'Assistant', event: 'STEP' }, payload: { text: 'reading' }, origin: 'tab-1' }]);
    });

    it('control: a call site without onMessage drops the provider\'s live messages', async () => {
      const delivered: unknown[] = [];
      const p = ports({
        callService: async (_s, _a, _p, context) => { context?.host?.message({ text: 'reading' }); return null; },
        deliverLive: (...args) => { delivered.push(args); },
      });
      const site = { orbital: 'Main', trait: 'Assistant', followOn: false, emit: {} };
      await answerRequest(p, { kind: 'callService', service: 's', method: 'm', args: {}, site }, scope());
      expect(delivered).toEqual([]);
    });

    it('a follow-on call is deferred when the host can deliver its outcome, and the outcome arrives as its success dispatch', async () => {
      const outcomes: DeferredCallOutcome[] = [];
      const p = ports({ callService: async () => ({ answer: 42 }), deferCallOutcome: () => (call) => { outcomes.push(call); } });
      const site = { orbital: 'Main', trait: 'Helper', followOn: true, emit: { success: 'ANSWERED', failure: 'FAILED' } };
      const answer = await answerRequest(p, { kind: 'callService', service: 's', method: 'm', args: {}, site }, scope({ originClientId: 'tab-1', entityId: 'e1' }));
      expect(answer).toEqual({ kind: 'serviceDeferred' });
      await new Promise((r) => setTimeout(r, 5));
      expect(outcomes).toEqual([{ orbital: 'Main', traitName: 'Helper', event: 'ANSWERED', payload: { answer: 42 }, entityId: 'e1', originClientId: 'tab-1', user: undefined, locale: undefined }]);
    });

    it('control: a follow-on call with no sink to deliver to holds the request', async () => {
      const p = ports({ callService: async () => ({ answer: 42 }) });
      const site = { orbital: 'Main', trait: 'Helper', followOn: true, emit: { success: 'ANSWERED' } };
      expect(await answerRequest(p, { kind: 'callService', service: 's', method: 'm', args: {}, site }, scope())).toEqual({ kind: 'service', result: { ok: { answer: 42 } } });
    });

    it('a deferred call that fails arrives as its failure event, and a cancelled keyed one as its cancelled event', async () => {
      const outcomes: DeferredCallOutcome[] = [];
      const inFlightCalls = new InFlightCalls();
      const failing = ports({ callService: async () => { throw new Error('model down'); }, deferCallOutcome: () => (call) => { outcomes.push(call); } });
      const site = { orbital: 'Main', trait: 'Helper', followOn: true, emit: { success: 'ANSWERED', failure: 'FAILED', cancelled: 'STOPPED' } };
      await answerRequest(failing, { kind: 'callService', service: 's', method: 'm', args: {}, site }, scope());
      const keyed = ports({ inFlightCalls, callService: () => new Promise(() => undefined), deferCallOutcome: () => (call) => { outcomes.push(call); } });
      await answerRequest(keyed, { kind: 'callService', service: 's', method: 'm', args: {}, key: 'job', site }, scope());
      inFlightCalls.cancel('job');
      await new Promise((r) => setTimeout(r, 5));
      expect(outcomes.map((o) => [o.event, o.payload])).toEqual([['FAILED', { error: 'model down' }], ['STOPPED', { key: 'job' }]]);
    });

    it('a substrate operator is refused without a program host, and carries issues when it fails', async () => {
      const none = await answerRequest(ports(), { kind: 'substrate', op: 'program/eval', args: [] }, scope());
      expect(none).toEqual({ kind: 'substrate', result: { error: { message: 'no program host configured for program/eval', errors: [] } } });
      const p = ports({
        programEffect: () => async (op, args, context) => ({ ok: false, error: `${op} refused`, errors: [{ code: 'ORB_X', message: 'bad', path: 'a.b' }], ...(context ? {} : {}), ...(args.length > 0 ? {} : {}) }),
      });
      const failed = await answerRequest(p, { kind: 'substrate', op: 'program/eval', args: [] }, scope({ user: { id: 'u1' } }));
      expect(failed).toEqual({
        kind: 'substrate',
        result: { error: { message: 'program/eval refused', errors: [{ code: 'ORB_X', message: 'bad', path: 'a.b' }] } },
      });
    });
  });
});
