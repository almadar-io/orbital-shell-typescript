// Runtime Spec Clause 8.3: the kernel names the traits that left the page and the leg that releases each, and the client posts them so the server pauses their mount-scoped ticks.
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { OrbitalSchema, ResolvedTraitBinding } from '@almadar/core';
import type { EventTransport, EventTransportRegisterResult } from '../../src';
import type { EventRequest, EventResponse } from '@almadar/core';
import { UNMOUNT_EVENT } from '@almadar/core';
import { useCircuitKernel } from '../../src/hooks/circuit/useCircuitKernel';
import { ENGINES, TEST_TYPE_CONTRACT_VERSION, TEST_STAMP } from '../../src/test-support/kernel-engine';
import type { KernelEngineValue } from '../../src/providers/KernelEngineContext';

function trait(name: string): OrbitalSchema['orbitals'][number]['traits'][number] {
  return {
    name,
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }],
      events: [],
      transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [] }],
    },
  };
}

const orbitals: OrbitalSchema['orbitals'] = [
  { name: 'Feed', pages: [], entity: { name: 'Post', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] }, traits: [trait('Ticker'), trait('Clock')] },
  { name: 'Side', pages: [], entity: { name: 'Note', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] }, traits: [trait('Notes')] },
];

function binding(name: string): ResolvedTraitBinding {
  return {
    trait: {
      name,
      source: 'schema',
      states: [{ name: 'idle', isInitial: true, isFinal: false }],
      events: [],
      transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [] }],
      guards: [],
      ticks: [],
      listens: [],
      dataEntities: [],
    },
  };
}

class RecordingTransport implements EventTransport {
  readonly sent: Array<{ orbital: string; request: EventRequest }> = [];
  constructor(private readonly fail = false) {}
  register(): Promise<EventTransportRegisterResult> {
    return Promise.resolve({ success: true, carriesCircuitState: false });
  }
  unregister(): Promise<void> {
    return Promise.resolve();
  }
  send(orbital: string, request: EventRequest): Promise<EventResponse> {
    this.sent.push({ orbital, request });
    if (this.fail) return Promise.reject(new Error('offline'));
    return Promise.resolve({ success: true, transitioned: false, states: {}, emittedEvents: [] });
  }
  unmounts(): string[] {
    return this.sent.filter((s) => s.request.event === UNMOUNT_EVENT).map((s) => `${s.orbital}.${s.request.targetTrait ?? ''}`).sort();
  }
}

function mount(engine: KernelEngineValue, transport: RecordingTransport, names: string[], awaitTopology = false) {
  return renderHook(
    ({ bindings, pending }: { bindings: ResolvedTraitBinding[]; pending: boolean }) =>
      useCircuitKernel(bindings, { stamp: TEST_STAMP, orbitals, transport, awaitTopology: pending, engine }),
    { initialProps: { bindings: names.map(binding), pending: awaitTopology } },
  );
}

type Hook = ReturnType<typeof mount>;
const names = (list: string[]) => list.map(binding);
const enter = (hook: Hook, list: string[]) => act(async () => { await hook.result.current.engine!.enter(undefined, 'page', list); });
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe.each(ENGINES)('the kernel client posts $UNMOUNT for traits leaving the page [%s engine]', (_name, engine) => {
  it('entering posts no unmount', async () => {
    const transport = new RecordingTransport();
    const hook = mount(engine, transport, ['Ticker', 'Notes']);
    await enter(hook, ['Ticker', 'Notes']);
    await flush();
    expect(transport.unmounts()).toEqual([]);
  });

  it('a dropped trait is unmounted once, on its own orbital, with the tab id', async () => {
    const transport = new RecordingTransport();
    const hook = mount(engine, transport, ['Ticker', 'Clock', 'Notes']);
    await enter(hook, ['Ticker', 'Clock', 'Notes']);
    hook.rerender({ bindings: names(['Clock']), pending: false });
    await enter(hook, ['Clock']);
    await flush();
    expect(transport.unmounts()).toEqual(['Feed.Ticker', 'Side.Notes']);
    const clientIds = new Set(transport.sent.map((s) => s.request.clientId));
    expect(clientIds.size).toBe(1);
    expect([...clientIds][0]).toMatch(/.+/);
    await enter(hook, ['Clock']);
    await flush();
    expect(transport.unmounts()).toEqual(['Feed.Ticker', 'Side.Notes']);
  });

  it('a new bindings array with the same traits unmounts nothing', async () => {
    const transport = new RecordingTransport();
    const hook = mount(engine, transport, ['Ticker', 'Notes']);
    await enter(hook, ['Ticker', 'Notes']);
    hook.rerender({ bindings: names(['Notes', 'Ticker']), pending: false });
    await enter(hook, ['Notes', 'Ticker']);
    await flush();
    expect(transport.unmounts()).toEqual([]);
  });

  it('a trait that leaves and comes back is unmounted only for the time it was gone', async () => {
    const transport = new RecordingTransport();
    const hook = mount(engine, transport, ['Ticker', 'Notes']);
    await enter(hook, ['Ticker', 'Notes']);
    hook.rerender({ bindings: names(['Notes']), pending: false });
    await enter(hook, ['Notes']);
    hook.rerender({ bindings: names(['Ticker', 'Notes']), pending: false });
    await enter(hook, ['Ticker', 'Notes']);
    await act(async () => { await hook.result.current.engine!.leave(); });
    await flush();
    expect(transport.unmounts()).toEqual(['Feed.Ticker', 'Feed.Ticker', 'Side.Notes']);
  });

  it('closing the page unmounts every trait still on it', async () => {
    const transport = new RecordingTransport();
    const hook = mount(engine, transport, ['Ticker', 'Clock', 'Notes']);
    await enter(hook, ['Ticker', 'Clock', 'Notes']);
    await act(async () => { await hook.result.current.engine!.leave(); });
    await flush();
    expect(transport.unmounts()).toEqual(['Feed.Clock', 'Feed.Ticker', 'Side.Notes']);
  });

  it('nothing is posted while the topology is pending, and the held releases go out once it is known', async () => {
    const transport = new RecordingTransport();
    const hook = mount(engine, transport, ['Ticker', 'Notes'], true);
    await enter(hook, ['Ticker', 'Notes']);
    hook.rerender({ bindings: names(['Notes']), pending: true });
    await enter(hook, ['Notes']);
    await flush();
    expect(transport.unmounts()).toEqual([]);
    hook.rerender({ bindings: names(['Notes']), pending: false });
    await flush();
    expect(transport.unmounts()).toEqual(['Feed.Ticker']);
    await act(async () => { await hook.result.current.engine!.leave(); });
    await flush();
    expect(transport.unmounts()).toEqual(['Feed.Ticker', 'Side.Notes']);
  });

  it('a failed unmount post does not break closing the page', async () => {
    const transport = new RecordingTransport(true);
    const hook = mount(engine, transport, ['Ticker']);
    await enter(hook, ['Ticker']);
    await act(async () => { await expect(hook.result.current.engine!.leave()).resolves.toBeUndefined(); });
    await flush();
    expect(transport.unmounts()).toEqual(['Feed.Ticker']);
  });
});
