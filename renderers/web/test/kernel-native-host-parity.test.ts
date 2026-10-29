import { expect, it } from 'vitest';
import { OrbitalSchemaSchema, type EventStreamItem } from '@almadar/core';
import { untouchedPersistence } from './helpers/persistence.js';
import { InFlightCalls } from '../src/effects/in-flight-calls.js';
import { KernelEngine } from '../src/kernel/engine.js';
import type { KernelHostPorts } from '../src/kernel/host.js';
import { loadTestKernel, TEST_TYPE_CONTRACT_VERSION } from '../src/test-support/kernel-engine.js';

const schema = OrbitalSchemaSchema.parse({
  name: 'Parity',
  typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
  orbitals: [{ name: 'Main', entity: { name: 'Job', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] }, traits: [{ name: 'Worker', linkedEntity: 'Job', stateMachine: {
    events: [{ key: 'GO', name: 'GO' }, { key: 'ASK', name: 'ASK' }, { key: 'FINISH', name: 'FINISH' }],
    states: [{ name: 'idle', isInitial: true }, { name: 'busy' }, { name: 'done' }],
    transitions: [
      { from: 'idle', to: 'idle', event: 'GO', effects: [['emit', 'FIRST', {}], ['navigate', '/next'], ['emit', 'LAST', {}]] },
      { from: 'idle', to: 'busy', event: 'ASK', effects: [['call-service', 'test', 'wait', {}]] },
      { from: 'busy', to: 'done', event: 'FINISH', effects: [] },
    ],
  } }] }],
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

it('the actual wasm supplies ordered stream items and queues unrelated dispatches behind a parked ask', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const calls: string[] = [];
  const ports: KernelHostPorts = {
    persistence: untouchedPersistence(), inFlightCalls: new InFlightCalls(),
    callService: async () => { calls.push('ask'); await gate; return null; },
    programEffect: () => undefined,
    servicePorts: (caller, _user, message) => ({ caller, message, inputs: () => [], readableEntities: () => [], read: async () => [], dispatchInput: async () => { throw new Error('unused'); } }),
    deliverLive: () => undefined, deferCallOutcome: () => undefined,
  };
  const engine = KernelEngine.open(await loadTestKernel(), schema, ports);
  try {
    const items: EventStreamItem[] = [];
    const response = await engine.evaluate('Main', { event: 'GO', targetTrait: 'Worker' }, { orbital: 'Main', onStream: (item) => { items.push(item); } });
    expect(items.map((item) => item.type)).toEqual(['event', 'effect', 'event', 'complete']);
    expect(items[0]).toMatchObject({ type: 'event', data: { event: 'FIRST' } });
    expect(items[1]).toMatchObject({ type: 'effect', data: ['navigate', '/next'] });
    expect(items[2]).toMatchObject({ type: 'event', data: { event: 'LAST' } });
    expect(items[3]).toMatchObject({ type: 'complete', data: response });
    const first = engine.evaluate('Main', { event: 'ASK', targetTrait: 'Worker' }, { orbital: 'Main' });
    await flush();
    const second = engine.evaluate('Main', { event: 'FINISH', targetTrait: 'Worker' }, { orbital: 'Main' }).then((result) => { calls.push('finish'); return result; });
    await flush();
    expect(calls).toEqual(['ask']);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.states.Worker).toBe('busy');
    expect(b.states.Worker).toBe('done');
    expect(calls).toEqual(['ask', 'finish']);
  } finally { release(); engine.dispose(); }
});

it('the actual wasm reports same-turn service reentry as a failure without hanging', async () => {
  const ports: KernelHostPorts = {
    persistence: untouchedPersistence(), inFlightCalls: new InFlightCalls(),
    callService: async (_service, _action, _params, context) => {
      await context?.host?.dispatchInput('Main', { targetTrait: 'Worker', event: 'GO' });
      return null;
    },
    programEffect: () => undefined,
    servicePorts: (caller, _user, message, assertReentry) => ({ caller, message, inputs: () => [], readableEntities: () => [], read: async () => [], dispatchInput: async () => { assertReentry?.(); throw new Error('reentry was not refused'); } }),
    deliverLive: () => undefined, deferCallOutcome: () => undefined,
  };
  const engine = KernelEngine.open(await loadTestKernel(), schema, ports);
  try {
    const response = await engine.evaluate('Main', { event: 'ASK', targetTrait: 'Worker' }, { orbital: 'Main' });
    expect(response.rejections).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'effect-failed', error: expect.stringContaining('is parked holding the dispatch lane') })]));
  } finally { engine.dispose(); }
});
