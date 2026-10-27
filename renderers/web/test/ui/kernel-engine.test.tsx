// @vitest-environment jsdom
// The kernel engine (`@almadar/kernel`, the Rust client-role kernel as WebAssembly), the one client engine: a
// `KernelEngineProvider` supplies its loader, and a circuit with none above it refuses to run.
import React from 'react';
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { OrbitalSchema, ResolvedTraitBinding } from '@almadar/core';
import { createEmptyResolvedTrait } from '@almadar/core';
import type { EventTransport, EventTransportRegisterResult } from '../../src';
import type { OrbitalEventRequest, OrbitalEventResponse } from '@almadar/core';
import { useCircuitKernel } from '../../src/hooks/circuit/useCircuitKernel';
import { useTraitStateMachine } from '../../src/hooks/useTraitStateMachine';
import { useEntityBindingSource } from '../../src/hooks/circuit/useEntityBindingSource';
import type { FrameScheduler } from '../../src/lib/kernel-frames';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import { KernelEngineProvider, KernelLoaderMissingError, useKernelEngine } from '../../src/providers/KernelEngineContext';
import { resolveRenderBindingMarkers } from '../../src/lib/resolve-render-bindings';

// The provider's own contract: the shared setup's test kernel is not used here.
vi.unmock('../../src/providers/KernelEngineContext');
import { KERNEL_AVAILABLE, KERNEL_ENGINE, warmKernel } from '../../src/test-support/kernel-engine';

const describeKernel = KERNEL_AVAILABLE ? describe : describe.skip;

const driverTrait = (name: string, bump: unknown[]): OrbitalSchema['orbitals'][number]['traits'][number] => ({
  name,
  linkedEntity: 'Board',
  stateMachine: {
    states: [{ name: 'idle', isInitial: true }, { name: 'busy' }],
    events: [],
    transitions: [
      { from: 'idle', to: 'idle', event: 'INIT', effects: [] },
      { from: 'idle', to: 'busy', event: 'BUMP', effects: bump as never },
    ],
  },
  ticks: [{ name: 'beat', interval: 1000, effects: [['set', '@entity.score', ['+', '@entity.score', 1]]] }],
});

const orbitals = (persistence: 'runtime' | 'persistent', bump: unknown[], traits: readonly string[] = ['Driver']): OrbitalSchema['orbitals'] => [{
  name: 'Main',
  pages: [],
  entity: { name: 'Board', persistence, fields: [{ name: 'id', type: 'string' }, { name: 'score', type: 'number', default: 0 }] },
  traits: traits.map((name) => driverTrait(name, bump)),
}];

const bindings: ResolvedTraitBinding[] = [{ trait: createEmptyResolvedTrait('Driver', 'schema'), linkedEntity: 'Board' }];

class Server implements EventTransport {
  readonly sent: OrbitalEventRequest[] = [];
  constructor(private readonly answer: OrbitalEventResponse | Error) {}
  register(): Promise<EventTransportRegisterResult> { return Promise.resolve({ success: true, carriesCircuitState: false }); }
  unregister(): Promise<void> { return Promise.resolve(); }
  send(_orbital: string, request: OrbitalEventRequest): Promise<OrbitalEventResponse> {
    this.sent.push(request);
    return this.answer instanceof Error ? Promise.reject(this.answer) : Promise.resolve(this.answer);
  }
}

const persistBump = [['set', '@entity.score', 5], ['persist', 'create', 'Board', { score: 5 }]];

describe('KernelEngineProvider', () => {
  it('supplies no kernel without a provider', () => {
    const { result } = renderHook(() => useKernelEngine());
    expect(result.current).toBeNull();
  });

  it('a circuit with no kernel loader above it refuses to run', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('runtime', []), engine: null }))).toThrow(KernelLoaderMissingError);
    quiet.mockRestore();
  });

  it('loads the module once for every circuit under it', async () => {
    const loader = vi.fn(() => KERNEL_ENGINE.loadModule());
    const wrapper = ({ children }: { children: React.ReactNode }) => <KernelEngineProvider loader={loader}>{children}</KernelEngineProvider>;
    const { result } = renderHook(() => useKernelEngine(), { wrapper });
    await result.current?.loadModule();
    await result.current?.loadModule();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describeKernel('useCircuitKernel on the kernel engine', () => {
  beforeAll(warmKernel);

  it('exposes the kernel client the circuit runs on', () => {
    const kernel = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('runtime', []), engine: KERNEL_ENGINE }));
    expect(kernel.result.current.engine).toBeDefined();
  });

  it('an equal orbital set passed as a new array keeps the same kernel client (G-UI-102)', () => {
    const { result, rerender } = renderHook(
      ({ set }: { set: ReturnType<typeof orbitals> }) => useCircuitKernel(bindings, { orbitals: set, engine: KERNEL_ENGINE }),
      { initialProps: { set: orbitals('runtime', []) } },
    );
    const first = result.current.engine;
    rerender({ set: orbitals('runtime', []) });
    expect(result.current.engine).toBe(first);
  });

  it('control: a changed orbital set builds a new kernel client', () => {
    const { result, rerender } = renderHook(
      ({ set }: { set: ReturnType<typeof orbitals> }) => useCircuitKernel(bindings, { orbitals: set, engine: KERNEL_ENGINE }),
      { initialProps: { set: orbitals('runtime', []) } },
    );
    const first = result.current.engine;
    rerender({ set: orbitals('runtime', [['set', '@entity.score', 5]]) });
    expect(result.current.engine).not.toBe(first);
  });

  it('mirrors the kernel run into the store the hooks read', async () => {
    const { result } = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('runtime', [['set', '@entity.score', 5]]), engine: KERNEL_ENGINE }));
    await act(async () => { await result.current.kernel.dispatch({ event: 'BUMP', targetTrait: 'Driver' }); });
    expect(result.current.store.states.getState('Driver')?.currentState).toBe('busy');
    expect(result.current.store.frames.get('Driver')?.score).toBe(5);
    expect(result.current.engine?.traitState('Driver')).toBe('busy');
  });

  it('posts the kernel leg and paints the server render after the local arm', async () => {
    const server = new Server({
      success: true, transitioned: true, states: { Driver: 'busy' }, emittedEvents: [],
      clientEffectsByTrait: [{ traitName: 'Driver', effect: ['render-ui', 'main', { type: 'box', className: 'server' }] }],
    });
    const { result } = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('persistent', persistBump), transport: server, engine: KERNEL_ENGINE }));
    const painted: string[] = [];
    const outcome = await result.current.kernel.dispatch({ event: 'BUMP', targetTrait: 'Driver' }, { onLocal: () => painted.push('local') });
    expect(server.sent).toHaveLength(1);
    expect(server.sent[0]).toMatchObject({ event: 'BUMP', targetTrait: 'Driver' });
    expect(server.sent[0]?.traits).toBeUndefined();
    expect(painted).toEqual(['local']);
    expect(outcome.localPainted).toBe(true);
    expect(outcome.serverEffects?.clientEffectsByTrait?.map((e) => e.effect)).toEqual([['render-ui', 'main', { type: 'box', className: 'server' }]]);
    expect(result.current.store.states.getState('Driver')?.currentState).toBe('busy');
  });

  it('control: a client-only dispatch posts nothing', async () => {
    const server = new Server({ success: true, transitioned: true, states: {}, emittedEvents: [] });
    const { result } = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('runtime', [['set', '@entity.score', 5]]), transport: server, engine: KERNEL_ENGINE }));
    const outcome = await result.current.kernel.dispatch({ event: 'BUMP', targetTrait: 'Driver' });
    expect(server.sent).toHaveLength(0);
    expect(outcome.localPainted).toBeUndefined();
  });

  it('a stateful host is posted the event of a server-backed dispatch that delegated nothing', async () => {
    const server = new Server({ success: true, transitioned: true, states: { Driver: 'idle' }, emittedEvents: [] });
    const { result } = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('persistent', []), transport: server, engine: KERNEL_ENGINE }));
    await act(async () => { await result.current.kernel.dispatch({ event: 'INIT', targetTrait: 'Driver' }); });
    expect(server.sent).toHaveLength(1);
    expect(server.sent[0]).toMatchObject({ event: 'INIT', targetTrait: 'Driver', sourceTrait: 'Driver' });
    expect(server.sent[0]?.traits).toBeUndefined();
  });

  it('control: a stateless host is posted nothing for a dispatch that delegated nothing', async () => {
    const server = new Server({ success: true, transitioned: true, states: {}, emittedEvents: [] });
    const { result } = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('persistent', []), transport: server, carriesCircuitState: true, engine: KERNEL_ENGINE }));
    await act(async () => { await result.current.kernel.dispatch({ event: 'INIT', targetTrait: 'Driver' }); });
    expect(server.sent).toHaveLength(0);
  });

  it('a mount posts one leg for all the seeds of an orbital', async () => {
    const server = new Server({ success: true, transitioned: true, states: { Driver: 'idle', Second: 'idle' }, emittedEvents: [] });
    const { result } = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('persistent', [], ['Driver', 'Second']), transport: server, engine: KERNEL_ENGINE }));
    const outcome = await act(async () => result.current.kernel.dispatchMount([{ trait: 'Driver', event: 'INIT' }, { trait: 'Second', event: 'INIT' }], undefined, {}));
    expect(server.sent).toHaveLength(1);
    expect(server.sent[0]?.mount?.map((m) => m.trait)).toEqual(['Driver', 'Second']);
    expect(outcome.posted).toBe(true);
  });

  it('control: a mount of client-only seeds posts nothing', async () => {
    const server = new Server({ success: true, transitioned: true, states: {}, emittedEvents: [] });
    const { result } = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('runtime', []), transport: server, engine: KERNEL_ENGINE }));
    const outcome = await act(async () => result.current.kernel.dispatchMount([{ trait: 'Driver', event: 'INIT' }], undefined, {}));
    expect(server.sent).toHaveLength(0);
    expect(outcome.posted).toBe(false);
  });

  it('hands the observer every executed hop of a dispatch', async () => {
    const hops: Array<{ traitName: string; from: string; to: string; event: string }> = [];
    const observer = { onTransition: (trace: { traitName: string; from: string; to: string; event: string }) => { hops.push({ traitName: trace.traitName, from: trace.from, to: trace.to, event: trace.event }); } };
    const { result } = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('runtime', [['set', '@entity.score', 5]]), observer, engine: KERNEL_ENGINE }));
    await act(async () => { await result.current.kernel.dispatch({ event: 'BUMP', targetTrait: 'Driver' }); });
    expect(hops).toEqual([{ traitName: 'Driver', from: 'idle', to: 'busy', event: 'BUMP' }]);
  });

  it('control: a rejected dispatch leaves the observer silent', async () => {
    const hops: string[] = [];
    const observer = { onTransition: (trace: { event: string }) => { hops.push(trace.event); } };
    const { result } = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('runtime', []), observer, engine: KERNEL_ENGINE }));
    await act(async () => { await result.current.kernel.dispatch({ event: 'BUMP', targetTrait: 'Driver' }).catch(() => undefined); });
    await act(async () => { await result.current.kernel.dispatch({ event: 'BUMP', targetTrait: 'Driver' }).catch(() => undefined); });
    expect(hops.filter((e) => e === 'BUMP')).toHaveLength(1);
  });

  it('rolls an optimistic dispatch back when the server rejects it', async () => {
    const server = new Server({ success: false, transitioned: false, states: {}, emittedEvents: [], error: 'no' });
    const { result } = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('runtime', persistBump), transport: server, engine: KERNEL_ENGINE }));
    await act(async () => { await result.current.kernel.dispatch({ event: 'INIT', targetTrait: 'Driver' }); });
    const outcome = await act(async () => result.current.kernel.dispatch({ event: 'BUMP', targetTrait: 'Driver' }));
    expect(outcome.mode).toBe('runtimeOptimistic');
    expect(outcome.response.success).toBe(false);
    expect(result.current.store.states.getState('Driver')?.currentState).toBe('idle');
    expect(result.current.engine?.traitState('Driver')).toBe('idle');
  });

  it('rolls back and rejects when the transport fails', async () => {
    const server = new Server(new Error('offline'));
    const { result } = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('runtime', persistBump), transport: server, carriesCircuitState: true, engine: KERNEL_ENGINE }));
    await act(async () => { await result.current.kernel.dispatch({ event: 'INIT', targetTrait: 'Driver' }); });
    await expect(result.current.kernel.dispatch({ event: 'BUMP', targetTrait: 'Driver' })).rejects.toThrow('offline');
    expect(result.current.store.states.getState('Driver')?.currentState).toBe('idle');
  });

  it('reports a dispatch to a trait the program does not declare', async () => {
    const { result } = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('runtime', []), engine: KERNEL_ENGINE }));
    await expect(result.current.kernel.dispatch({ event: 'BUMP', targetTrait: 'Ghost' })).rejects.toThrow();
  });
});

describeKernel('useTraitStateMachine on the kernel engine', () => {
  beforeAll(warmKernel);

  function stubSlots(): UISlotManager {
    return {
      slots: {}, render: vi.fn(() => 'id'), clear: vi.fn(), clearBySource: vi.fn(), clearById: vi.fn(), clearAll: vi.fn(),
      subscribe: vi.fn(() => () => undefined), hasContent: vi.fn(() => false), getContent: vi.fn(() => null),
      getTraitContent: vi.fn(() => null), subscribeTrait: vi.fn(() => () => undefined), updateTraitContent: vi.fn(() => 'id'),
    };
  }

  function clock(): { schedule: FrameScheduler; step: (nowMs: number) => Promise<void>; pending: () => number } {
    let callback: ((nowMs: number) => void) | undefined;
    return {
      schedule: (cb) => { callback = cb; return () => { callback = undefined; }; },
      step: async (nowMs) => { const cb = callback; callback = undefined; await act(async () => { cb?.(nowMs); }); },
      pending: () => (callback === undefined ? 0 : 1),
    };
  }

  const mountWith = (frames: ReturnType<typeof clock>) => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <KernelEngineProvider loader={() => KERNEL_ENGINE.loadModule!()} scheduleFrame={frames.schedule}>{children}</KernelEngineProvider>
    );
    return renderHook(() => useTraitStateMachine(bindings, stubSlots(), { orbitals: orbitals('runtime', []) }), { wrapper });
  };

  it('runs a declared tick from the kernel frame and shows its row to the binding source', async () => {
    const frames = clock();
    const { result } = mountWith(frames);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await frames.step(0);
    expect(result.current.entityBindingSource.getEntitySnapshot('Driver').score).toBe(0);
    await frames.step(1000);
    expect(result.current.entityBindingSource.getEntitySnapshot('Driver').score).toBe(1);
    await frames.step(2000);
    expect(result.current.entityBindingSource.getEntitySnapshot('Driver').score).toBe(2);
  });

  it('control: no tick is due before its interval', async () => {
    const frames = clock();
    const { result } = mountWith(frames);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await frames.step(0);
    await frames.step(400);
    expect(result.current.entityBindingSource.getEntitySnapshot('Driver').score).toBe(0);
  });

  it('pauses the frame clock while the document is hidden', async () => {
    const frames = clock();
    const { result } = mountWith(frames);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await frames.step(0);
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await frames.step(5000);
    expect(result.current.entityBindingSource.getEntitySnapshot('Driver').score).toBe(0);
    visibility.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await frames.step(6000);
    expect(result.current.entityBindingSource.getEntitySnapshot('Driver').score).toBe(0);
    visibility.mockRestore();
    await frames.step(7000);
    expect(result.current.entityBindingSource.getEntitySnapshot('Driver').score).toBe(1);
  });

  // Driver is mounted by the page; Rival is in the schema only, and its tick emits SURGE, which adds 100 to Driver's row.
  const rivalOrbitals = (withInit = true): OrbitalSchema['orbitals'] => {
    const base = orbitals('runtime', []);
    const board = base[0]!;
    const listening = {
      name: 'Driver', linkedEntity: 'Board',
      listens: [{ event: 'SURGE', source: { kind: 'any' as const }, triggers: 'SURGE_IN' }],
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [
          ...(withInit ? [{ from: 'idle', to: 'idle', event: 'INIT', effects: [] }] : []),
          { from: 'idle', to: 'idle', event: 'SURGE_IN', effects: [['set', '@entity.score', ['+', '@entity.score', 100]]] as never },
        ],
      },
      ticks: [{ name: 'beat', interval: 1000, effects: [['set', '@entity.score', ['+', '@entity.score', 1]]] as never }],
    };
    const rival = {
      name: 'Rival', linkedEntity: 'Board',
      emits: [{ event: 'SURGE', scope: 'external' as const }],
      stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] },
      ticks: [{ name: 'surge', interval: 1000, effects: [['emit', 'SURGE', {}]] as never }],
    };
    return [{ ...board, traits: [listening, rival] }];
  };
  const rivalBinding: ResolvedTraitBinding = { trait: createEmptyResolvedTrait('Rival', 'schema'), linkedEntity: 'Board' };

  const mountPage = (frames: ReturnType<typeof clock>, initial: ResolvedTraitBinding[], withInit = true) => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <KernelEngineProvider loader={() => KERNEL_ENGINE.loadModule!()} scheduleFrame={frames.schedule}>{children}</KernelEngineProvider>
    );
    const orbs = rivalOrbitals(withInit);
    return renderHook(({ traits }: { traits: ResolvedTraitBinding[] }) => useTraitStateMachine(traits, stubSlots(), { orbitals: orbs }), { wrapper, initialProps: { traits: initial } });
  };

  const settle = async (frames: ReturnType<typeof clock>): Promise<void> => {
    for (let i = 0; i < 500 && frames.pending() === 0; i++) await act(async () => { await Promise.resolve(); });
  };

  it('a frame before any mount seed ticks no unmounted trait', async () => {
    const frames = clock();
    const { result } = mountPage(frames, bindings, false);
    await settle(frames);
    await frames.step(0);
    await settle(frames);
    await frames.step(1000);
    expect(result.current.entityBindingSource.getEntitySnapshot('Driver').score).toBe(1);
  });

  it('control: a mounted trait ticks alongside', async () => {
    const frames = clock();
    const { result } = mountPage(frames, [...bindings, rivalBinding]);
    await settle(frames);
    await frames.step(0);
    await settle(frames);
    await frames.step(1000);
    expect(result.current.entityBindingSource.getEntitySnapshot('Driver').score).toBe(101);
  });

  it('an unmounted trait stops ticking', async () => {
    const { result } = renderHook(() => useCircuitKernel([...bindings, rivalBinding], { orbitals: rivalOrbitals(), engine: KERNEL_ENGINE }));
    const client = result.current.engine!;
    await client.mount(['Driver', 'Rival']);
    await result.current.kernel.dispatch({ event: 'INIT', targetTrait: 'Driver' });
    await client.frame(0);
    await client.frame(1000);
    expect(result.current.store.frames.get('Driver')?.score).toBe(101);
    await client.unmount(['Rival']);
    await client.frame(2000);
    expect(result.current.store.frames.get('Driver')?.score).toBe(102);
  });

  it('reads @state from the kernel', async () => {
    const frames = clock();
    const { result } = mountWith(frames);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(result.current.entityBindingSource.getState('Driver')).toBe('idle');
    expect(result.current.entityBindingSource.getState('Ghost')).toBe('');
  });
});

describe('useEntityBindingSource kernel state', () => {
  it('reads the state from the kernel client when one is given, the store otherwise', () => {
    const { result: stateless } = renderHook(() => useCircuitKernel(bindings, { orbitals: orbitals('runtime', []), engine: KERNEL_ENGINE }));
    const withKernel = renderHook(() => useEntityBindingSource(stateless.current.store, stateless.current.traitIndex, { traitState: () => 'from-kernel', traitConfig: () => undefined }));
    const withStore = renderHook(() => useEntityBindingSource(stateless.current.store, stateless.current.traitIndex));
    expect(withKernel.result.current.getState('Driver')).toBe('from-kernel');
    expect(withStore.result.current.getState('Driver')).toBe('idle');
  });
});

describe('resolveRenderBindingMarkers on kernel-resolved content', () => {
  it('passes the kernel\'s already-resolved render through untouched', () => {
    const resolved = { type: 'typography', content: 'Score: 7' };
    expect(resolveRenderBindingMarkers(resolved, 'Driver', { score: 7 }, undefined, 'idle')).toBe(resolved);
  });
});

// Behaviors the kernel client pins (docs/Almadar_Embedded_Kernel_Census.md section 5).
describeKernel('kernel engine parity', () => {
  beforeAll(warmKernel);

  describe.each([['kernel', KERNEL_ENGINE]] as const)('[%s engine]', (_name, engine) => {
    it('an unset @config knob renders as an unset prop, not null', async () => {
      const unset: OrbitalSchema['orbitals'] = [{
        name: 'O', pages: [],
        entity: { name: 'E', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [{
          name: 'T', linkedEntity: 'E',
          config: { hint: { type: 'string' } },
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }], events: [],
            transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'input-group', placeholder: '@config.hint', value: 'x' }]] }],
          },
        }],
      }];
      const trait: ResolvedTraitBinding = { trait: createEmptyResolvedTrait('T', 'schema'), linkedEntity: 'E' };
      const { result } = renderHook(() => useCircuitKernel([trait], { orbitals: unset, engine }));
      const outcome = await result.current.kernel.dispatch({ event: 'INIT', targetTrait: 'T' });
      const rendered = outcome.response.clientEffectsByTrait?.[0]?.effect;
      const pattern = rendered?.[0] === 'render-ui' ? rendered[2] : null;
      expect(pattern).not.toBeNull();
      expect(pattern !== null && pattern.type === 'input-group' ? pattern.placeholder : 'not an input-group').toBeUndefined();
    });

    it('a host\'s state for a client-only trait does not override the client\'s', async () => {
      const split = (traits: ResolvedTraitBinding[]) => renderHook(() => useCircuitKernel(traits, {
        orbitals: [
          {
            name: 'SearchOrbital', pages: [],
            entity: { name: 'Query', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
            traits: [{
              name: 'Searcher', linkedEntity: 'Query',
              emits: [{ event: 'REQUESTED', scope: 'external' }],
              stateMachine: { states: [{ name: 'idle', isInitial: true }, { name: 'searching' }], events: [], transitions: [{ from: 'idle', to: 'searching', event: 'GO', effects: [['emit', 'REQUESTED', {}]] }] },
            }],
          },
          {
            name: 'TaskOrbital', pages: [],
            entity: { name: 'Task', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
            traits: [{
              name: 'Responder', linkedEntity: 'Task',
              listens: [{ event: 'REQUESTED', source: { kind: 'any' }, triggers: 'REQUESTED' }],
              stateMachine: { states: [{ name: 'idle', isInitial: true }, { name: 'answering' }], events: [], transitions: [{ from: 'idle', to: 'answering', event: 'REQUESTED', effects: [['fetch', 'Task', {}]] }] },
            }],
          },
        ],
        transport: new Server({ success: true, transitioned: true, states: { Responder: 'answering', Searcher: 'idle' }, emittedEvents: [] }),
        engine,
      }));
      const { result } = split([{ trait: createEmptyResolvedTrait('Searcher', 'schema'), linkedEntity: 'Query' }]);
      await act(async () => { await result.current.kernel.dispatch({ event: 'GO', targetTrait: 'Searcher' }); });
      expect(result.current.store.states.getState('Searcher')?.currentState).toBe('searching');
    });

    it('a listen whose event is trait-qualified reaches its listener', async () => {
      const qualified: OrbitalSchema['orbitals'] = [{
        name: 'Snake', pages: [],
        entity: { name: 'S', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [
          {
            name: 'Play', linkedEntity: 'S',
            stateMachine: { states: [{ name: 'on', isInitial: true }], events: [], transitions: [{ from: 'on', to: 'on', event: 'UP', effects: [['emit', 'TURN', { dir: 'up' }]] }] },
          },
          {
            name: 'Mechanic', linkedEntity: 'S',
            listens: [{ event: 'Play.TURN', triggers: 'STEER' }],
            stateMachine: { states: [{ name: 'on', isInitial: true }], events: [], transitions: [{ from: 'on', to: 'on', event: 'STEER', effects: [['set', '@entity.dir', '@payload.dir']] }] },
          },
        ],
      }];
      const traits: ResolvedTraitBinding[] = ['Play', 'Mechanic'].map((name) => ({ trait: createEmptyResolvedTrait(name, 'schema'), linkedEntity: 'S' }));
      const { result } = renderHook(() => useCircuitKernel(traits, { orbitals: qualified, engine }));
      await act(async () => { await result.current.kernel.dispatch({ event: 'UP', targetTrait: 'Play' }); });
      expect(result.current.store.frames.get('Mechanic')?.dir).toBe('up');
    });
  });
});
