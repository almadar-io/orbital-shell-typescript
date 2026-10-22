// program/inputs, program/dispatch and persist/read-named over the host ports. The vectors are the shared
// corpus the Rust kernel (`orbital-core-runtime` tests/agent_ports.rs) runs on the same fixture.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  agentPortPayload,
  dispatchOutcomeOf,
  externalInputsOf,
  isAgentPortOperator,
  parseOrbitalSchema,
  readableEntitiesOf,
  runAgentPort,
  type AgentPortOperator,
  type DispatchRequestOutcome,
  type EventStreamItem,
  type EntityRow,
  type JsonValue,
  type OrbitalEventResponse,
  type ServiceHostPorts,
} from '../index';

interface Dispatched {
  address: string;
  payload: JsonValue;
}

interface Case {
  name: string;
  op: AgentPortOperator;
  args: JsonValue[];
  dispatched: Dispatched | null;
  expect: JsonValue;
  text?: string;
}

interface Vectors {
  caller: { orbital: string; trait: string };
  schema: JsonValue;
  rows: Record<string, EntityRow[]>;
  scripted: Record<string, OrbitalEventResponse>;
  dispatchOutcomes: Array<{ name: string; response: OrbitalEventResponse; outcome: JsonValue }>;
  cases: Case[];
}

const local = new URL('./fixtures/agent-ports/vectors.json', import.meta.url);
const canonical = new URL('../../../orbital-core/crates/runtime/tests/fixtures/agent-ports/vectors.json', import.meta.url);
const vectors: Vectors = JSON.parse(readFileSync(local, 'utf8'));
const schema = parseOrbitalSchema(vectors.schema);

function hostPorts(dispatched: Dispatched[]): ServiceHostPorts {
  return {
    caller: vectors.caller,
    message: () => {},
    inputs: () => externalInputsOf(schema),
    readableEntities: () => readableEntitiesOf(schema),
    dispatchInput: async (orbital, request) => {
      const payload: JsonValue = JSON.parse(JSON.stringify(request.payload ?? {}));
      dispatched.push({ address: `${orbital}.${request.targetTrait}.${request.event}`, payload });
      const scripted = vectors.scripted[request.event];
      if (scripted === undefined) throw new Error(`no scripted response for ${request.event}`);
      return scripted;
    },
    read: async (entity) => vectors.rows[entity] ?? [],
  };
}

describe('agent ports: shared vectors', () => {
  it('covers the three operators with positive and control cases', () => {
    expect(new Set(vectors.cases.map((c) => c.op))).toEqual(new Set(['program/inputs', 'program/dispatch', 'persist/read-named']));
    expect(vectors.cases.some((c) => c.dispatched !== null)).toBe(true);
    expect(vectors.cases.some((c) => c.dispatched === null && c.op === 'program/dispatch')).toBe(true);
    expect(new Set(vectors.cases.map((c) => c.name)).size).toBe(vectors.cases.length);
  });

  it.skipIf(!existsSync(canonical))('matches the canonical corpus byte-for-byte (monorepo)', () => {
    expect(readFileSync(local).equals(readFileSync(canonical)), 'agent-ports corpus differs').toBe(true);
  });

  for (const c of vectors.cases) {
    it(c.name, async () => {
      const dispatched: Dispatched[] = [];
      const outcome = await runAgentPort(c.op, c.args, hostPorts(dispatched));
      expect(JSON.parse(JSON.stringify(outcome))).toEqual(c.expect);
      if (c.text !== undefined && outcome.ok) expect(agentPortPayload(outcome.result).text).toBe(c.text);
      expect(dispatched).toEqual(c.dispatched === null ? [] : [c.dispatched]);
    });
  }

  for (const v of vectors.dispatchOutcomes) {
    it(`dispatch outcome: ${v.name}`, () => {
      expect(dispatchOutcomeOf(v.response)).toEqual(v.outcome);
    });
  }

  it('names the three operators and nothing else', () => {
    expect(['program/inputs', 'program/dispatch', 'persist/read-named'].every(isAgentPortOperator)).toBe(true);
    expect(isAgentPortOperator('program/eval')).toBe(false);
    expect(isAgentPortOperator('persist')).toBe(false);
  });
});

describe('agent ports: event requests, inbound deliveries and the trace (owner, 2026-10-21)', () => {
  const response: OrbitalEventResponse = { success: true, transitioned: true, states: { Chat: 'idle' }, emittedEvents: [] };
  type Asked = { orbital: string; request: JsonValue; input: boolean };

  function richPorts(asked: Asked[], answer: DispatchRequestOutcome = { ok: true, response }): ServiceHostPorts {
    return {
      ...hostPorts([]),
      dispatchRequest: async (orbital, request, input) => {
        asked.push({ orbital, request: JSON.parse(JSON.stringify(request)), input });
        return answer;
      },
      deliverInbound: async (name, delivery) => ({ status: 202, body: JSON.stringify({ name, ...delivery }) }),
      trace: (steps) => Array.from({ length: steps }, (_, seq) => ({ seq })),
    };
  }

  const base = { orbital: 'Desk', targetTrait: 'Chat', event: 'ADD_NOTE' };
  const dispatchWith = (options: { [key: string]: JsonValue }, ports: ServiceHostPorts) =>
    runAgentPort('program/dispatch', ['Desk.Chat.ADD_NOTE', { title: 'x' }, { ...base, ...options }], ports);

  it('routes each request option onto the request the host dispatches', async () => {
    const cases: Array<[string, JsonValue, string]> = [
      ['entityId', 'n1', 'entityId'],
      ['clientId', 'tab-1', 'clientId'],
      ['locale', 'ar', 'locale'],
      ['traits', [{ trait: 'Chat', from: 'idle' }], 'traits'],
      ['mount', [{ trait: 'Chat', event: 'INIT' }], 'mount'],
      ['delivery', { event: 'ADD_NOTE', source: {} }, 'delivery'],
      ['dispatchLog', { prevEvents: [], prevStates: [] }, 'dispatchLog'],
      ['viewer', { id: 'u1' }, 'user'],
    ];
    for (const [key, given, field] of cases) {
      const asked: Asked[] = [];
      const outcome = await dispatchWith({ [key]: given }, richPorts(asked));
      expect(outcome.ok, key).toBe(true);
      expect(asked[0]?.request, key).toMatchObject({ event: 'ADD_NOTE', targetTrait: 'Chat', payload: { title: 'x' }, [field]: given });
    }
    const control: Asked[] = [];
    await dispatchWith({ clientId: '', locale: '', mount: [], delivery: {} }, richPorts(control));
    expect(control[0]?.request).toEqual({ event: 'ADD_NOTE', targetTrait: 'Chat', payload: { title: 'x' } });
  });

  it('answers the whole response under wire, the outcome without it, and passes input', async () => {
    const asked: Asked[] = [];
    expect(await dispatchWith({ wire: true, input: true }, richPorts(asked))).toEqual({ ok: true, result: response });
    expect(asked[0]?.input).toBe(true);
    expect(await dispatchWith({}, richPorts([]))).toEqual({ ok: true, result: { ok: true, emitted: [] } });
    const failed = await dispatchWith({ wire: true }, richPorts([], { ok: false, error: 'Orbital not found: Desk', code: 'ORBITAL_NOT_FOUND', status: 404 }));
    expect(failed).toEqual({ ok: false, error: 'Orbital not found: Desk', errors: [{ code: 'ORBITAL_NOT_FOUND', message: 'Orbital not found: Desk', status: 404 }] });
  });

  it('passes the stream request to the host and preserves its execution order', async () => {
    const streamItems: EventStreamItem[] = [
      { type: 'event', data: { event: 'FIRST' }, timestamp: 1 },
      { type: 'effect', data: ['navigate', '/middle'], timestamp: 2 },
      { type: 'event', data: { event: 'LAST' }, timestamp: 3 },
      { type: 'complete', data: response, timestamp: 4 },
    ];
    const requested: boolean[] = [];
    const ports: ServiceHostPorts = {
      ...richPorts([]),
      supportsDispatchStream: true,
      dispatchRequest: async (_orbital, _request, _input, stream) => {
        requested.push(stream === true);
        return { ok: true, response, streamItems };
      },
    };
    expect(await dispatchWith({ wire: true, stream: true }, ports)).toEqual({ ok: true, result: { ...response, items: streamItems } });
    expect(await dispatchWith({ wire: true }, ports)).toEqual({ ok: true, result: response });
    expect(requested).toEqual([true, false]);
    const unsupported: Asked[] = [];
    expect(await dispatchWith({ wire: true, stream: true }, richPorts(unsupported))).toEqual({ ok: false, error: 'program/dispatch: this host does not answer stream items' });
    expect(unsupported).toEqual([]);
  });

  it('refuses a malformed or unknown request option before the host is asked', async () => {
    const refusals: Array<[{ [key: string]: JsonValue }, string]> = [
      [{ verb: 'POST' }, 'unsupported option "verb"'],
      [{ wire: 'yes' }, 'option "wire" has the wrong shape'],
      [{ stream: true }, 'stream needs wire'],
      [{ traits: [{ trait: 'Chat' }] }, 'option "traits" has the wrong shape'],
      [{ viewer: 'u1' }, 'option "viewer" has the wrong shape'],
      [{ targetTrait: 'Other' }, "is not the request's 'Desk.Other.ADD_NOTE'"],
    ];
    for (const [options, why] of refusals) {
      const asked: Asked[] = [];
      const outcome = await dispatchWith(options, richPorts(asked));
      expect(outcome.ok === false && outcome.error.includes(why), JSON.stringify(options)).toBe(true);
      expect(asked).toEqual([]);
    }
  });

  it('delivers an inbound request and answers the handler status and body', async () => {
    const outcome = await runAgentPort('program/dispatch', [{ inbound: 'github', body: '{}', headers: { 'x-sig': 's' } }], richPorts([]));
    expect(outcome).toEqual({ ok: true, result: { status: 202, body: JSON.stringify({ name: 'github', headers: { 'x-sig': 's' }, rawBody: '{}' }) } });
    const refused = await runAgentPort('program/dispatch', [{ inbound: 'github', verb: 'POST' }], richPorts([]));
    expect(refused.ok).toBe(false);
  });

  it('answers the trace ask with the host trace, and the reflection with it when asked', async () => {
    expect(await runAgentPort('program/inputs', [{ trace: 2 }], richPorts([]))).toEqual({ ok: true, result: [{ seq: 0 }, { seq: 1 }] });
    const both = await runAgentPort('program/inputs', [{ select: [], trace: 1 }], richPorts([]));
    expect(both.ok && 'inputs' in both.result && both.result.trace).toEqual([{ seq: 0 }]);
    expect(await runAgentPort('program/inputs', [{ trace: 1 }], hostPorts([]))).toEqual({ ok: false, error: 'program/inputs: this host keeps no dispatch trace' });
    expect((await runAgentPort('program/inputs', [{ stats: true }], richPorts([]))).ok).toBe(false);
  });
});
