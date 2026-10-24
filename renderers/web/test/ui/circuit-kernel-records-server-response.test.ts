// Every server leg the circuit client posts is recorded on the verification timeline as a `server:<orbital>` trace, so runtime-verify can credit server-side outcomes (G-UI-021).
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { OrbitalSchema, ResolvedTraitBinding } from '@almadar/core';
import type { EventTransport, EventTransportRegisterResult } from '../../src';
import type { OrbitalEventRequest, OrbitalEventResponse } from '@almadar/core';
import { useCircuitKernel } from '../../src/hooks/circuit/useCircuitKernel';
import { ENGINES } from '../../src/test-support/kernel-engine';
import { clearVerification, getTransitions } from '../../src/lib/verificationRegistry';

const orbitals: OrbitalSchema['orbitals'] = [{
  name: 'Main', pages: [],
  entity: { name: 'Note', persistence: 'persistent', collection: 'notes', fields: [{ name: 'id', type: 'string' }, { name: 'title', type: 'string' }] },
  traits: [{
    name: 'Notes', linkedEntity: 'Note',
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }], events: [],
      transitions: [
        { from: 'idle', to: 'idle', event: 'SAVE', effects: [['persist', 'create', 'Note', { title: 'x' }, { emit: { success: 'SAVED' } }]] },
      ],
    },
  }],
}];

const binding: ResolvedTraitBinding = {
  trait: {
    name: 'Notes', source: 'schema', states: [{ name: 'idle', isInitial: true, isFinal: false }], events: [],
    transitions: [{ from: 'idle', to: 'idle', event: 'SAVE', effects: [] }], guards: [], ticks: [], listens: [], dataEntities: [],
  },
};

const answer: OrbitalEventResponse = {
  success: true, transitioned: true, states: { Notes: 'idle' },
  emittedEvents: [{ event: 'SAVED', payload: { id: 'n1', title: 'x' } }],
  effectResults: [{ effect: 'persist', action: 'create', entityType: 'Note', success: true, data: { id: 'n1', title: 'x' } }],
  data: { Note: [{ id: 'n1', title: 'x' }] },
};

class Server implements EventTransport {
  readonly sent: OrbitalEventRequest[] = [];
  constructor(private readonly fail = false) {}
  register(): Promise<EventTransportRegisterResult> { return Promise.resolve({ success: true, carriesCircuitState: false }); }
  unregister(): Promise<void> { return Promise.resolve(); }
  send(_orbital: string, request: OrbitalEventRequest): Promise<OrbitalEventResponse> {
    this.sent.push(request);
    return this.fail ? Promise.reject(new Error('offline')) : Promise.resolve(answer);
  }
}

const serverTraces = () => getTransitions().filter((t) => t.traitName === 'server:Main');

describe.each(ENGINES)('the circuit client records server responses [%s engine]', (_name, engine) => {
  beforeEach(() => clearVerification());

  it("a posted leg's response lands on the timeline with its emits, effect outcomes and data", async () => {
    const server = new Server();
    const { result } = renderHook(() => useCircuitKernel([binding], { orbitals, transport: server, engine }));
    await result.current.kernel.dispatch({ event: 'SAVE', targetTrait: 'Notes' });
    expect(server.sent.length).toBeGreaterThan(0);
    const [trace] = serverTraces();
    expect(trace?.event).toBe('SAVE');
    expect(trace?.serverResponse).toMatchObject({ orbitalName: 'Main', success: true, transitioned: true, emittedEvents: ['SAVED'], dataEntities: { Note: 1 } });
    expect(trace?.serverResponse?.emitted).toEqual([{ event: 'SAVED', payload: { id: 'n1', title: 'x' } }]);
    expect(trace?.effects).toEqual([expect.objectContaining({ type: 'persist', entityName: 'Note', action: 'create', resultId: 'n1', outcome: 'success' })]);
  });

  it('control: a failed post records nothing', async () => {
    const { result } = renderHook(() => useCircuitKernel([binding], { orbitals, transport: new Server(true), engine }));
    await result.current.kernel.dispatch({ event: 'SAVE', targetTrait: 'Notes' }).catch(() => undefined);
    expect(serverTraces()).toEqual([]);
  });
});
