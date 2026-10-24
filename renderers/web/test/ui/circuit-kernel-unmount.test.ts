// Runtime Spec Clause 8.3: the kernel tells the server when a trait leaves the page so its mount-scoped ticks pause.
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { OrbitalSchema, ResolvedTraitBinding } from '@almadar/core';
import type { EventTransport, EventTransportRegisterResult } from '../../src';
import type { OrbitalEventRequest, OrbitalEventResponse } from '@almadar/core';
import { UNMOUNT_EVENT } from '@almadar/core';
import { useCircuitKernel } from '../../src/hooks/circuit/useCircuitKernel';
import { ENGINES } from '../../src/test-support/kernel-engine';
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
  readonly sent: Array<{ orbital: string; request: OrbitalEventRequest }> = [];
  constructor(private readonly fail = false) {}
  register(): Promise<EventTransportRegisterResult> {
    return Promise.resolve({ success: true, carriesCircuitState: false });
  }
  unregister(): Promise<void> {
    return Promise.resolve();
  }
  send(orbital: string, request: OrbitalEventRequest): Promise<OrbitalEventResponse> {
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
      useCircuitKernel(bindings, { orbitals, transport, awaitTopology: pending, engine }),
    { initialProps: { bindings: names.map(binding), pending: awaitTopology } },
  );
}

describe.each(ENGINES)('useCircuitKernel [%s engine] posts $UNMOUNT for traits leaving the page', (_name, engine) => {
  it('mounting posts no unmount', () => {
    const transport = new RecordingTransport();
    mount(engine, transport, ['Ticker', 'Notes']);
    expect(transport.unmounts()).toEqual([]);
  });

  it('a dropped trait is unmounted once, on its own orbital, with the tab id', () => {
    const transport = new RecordingTransport();
    const hook = mount(engine, transport, ['Ticker', 'Clock', 'Notes']);
    hook.rerender({ bindings: ['Clock'].map(binding), pending: false });
    expect(transport.unmounts()).toEqual(['Feed.Ticker', 'Side.Notes']);
    const clientIds = new Set(transport.sent.map((s) => s.request.clientId));
    expect(clientIds.size).toBe(1);
    expect([...clientIds][0]).toMatch(/.+/);
    hook.rerender({ bindings: ['Clock'].map(binding), pending: false });
    expect(transport.unmounts()).toEqual(['Feed.Ticker', 'Side.Notes']);
  });

  it('a new bindings array with the same traits unmounts nothing', () => {
    const transport = new RecordingTransport();
    const hook = mount(engine, transport, ['Ticker', 'Notes']);
    hook.rerender({ bindings: ['Notes', 'Ticker'].map(binding), pending: false });
    expect(transport.unmounts()).toEqual([]);
  });

  it('a trait that leaves and comes back is unmounted only for the time it was gone', () => {
    const transport = new RecordingTransport();
    const hook = mount(engine, transport, ['Ticker', 'Notes']);
    hook.rerender({ bindings: ['Notes'].map(binding), pending: false });
    hook.rerender({ bindings: ['Ticker', 'Notes'].map(binding), pending: false });
    hook.unmount();
    expect(transport.unmounts()).toEqual(['Feed.Ticker', 'Feed.Ticker', 'Side.Notes']);
  });

  it('tearing the page down unmounts every trait still on it', () => {
    const transport = new RecordingTransport();
    const hook = mount(engine, transport, ['Ticker', 'Clock', 'Notes']);
    hook.unmount();
    expect(transport.unmounts()).toEqual(['Feed.Clock', 'Feed.Ticker', 'Side.Notes']);
  });

  it('nothing is unmounted while the topology is pending, and only confirmed mounts are released later', () => {
    const transport = new RecordingTransport();
    const hook = mount(engine, transport, ['Ticker', 'Notes'], true);
    hook.rerender({ bindings: ['Notes'].map(binding), pending: true });
    expect(transport.unmounts()).toEqual([]);
    hook.rerender({ bindings: ['Notes'].map(binding), pending: false });
    expect(transport.unmounts()).toEqual([]);
    hook.unmount();
    expect(transport.unmounts()).toEqual(['Side.Notes']);
  });

  it('a failed unmount post does not break teardown', async () => {
    const transport = new RecordingTransport(true);
    const hook = mount(engine, transport, ['Ticker']);
    expect(() => hook.unmount()).not.toThrow();
    await Promise.resolve();
    expect(transport.unmounts()).toEqual(['Feed.Ticker']);
  });
});
