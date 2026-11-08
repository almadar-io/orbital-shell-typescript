import './helpers/kernel-evaluator.setup.js';
// The outside-client input channel: only declared external inputs pass, as the session's identity (a request never names its viewer),
// through the same dispatch a click uses (guards, policies). The app's own event channel is unchanged.
import { describe, it, expect } from 'vitest';
import { OrbitalServerRuntime } from '../../src/runtime/OrbitalServerRuntime.js';
import { describeWithMemoryKernel, memoryKernel, nativeMemory } from './helpers/native-memory.js';
import type { OrbitalSchema, SExpr } from '@almadar/core';

const MEMBERS_ONLY: SExpr = ['=', '@user.role', 'member'];

function schema(): OrbitalSchema {
  return {
    name: 'external-input-app',
    typeContractVersion: 1,
    version: '1.0.0',
    orbitals: [
      {
        name: 'TaskOrbital',
        pages: [],
        entity: {
          name: 'Task',
          persistence: 'persistent',
          create_policy: MEMBERS_ONLY,
          fields: [
            { name: 'id', type: 'string', primaryKey: true },
            { name: 'title', type: 'string' },
            { name: 'ownerId', type: 'string' },
          ],
        },
        traits: [
          {
            name: 'TaskPersistor',
            linkedEntity: 'Task',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [
                { key: 'DO_CREATE', name: 'Do create', input: true, payloadSchema: [{ name: 'title', type: 'string', required: true }] },
                { key: 'SAVE', name: 'Save' },
              ],
              transitions: [
                {
                  from: 'idle', to: 'idle', event: 'DO_CREATE',
                  effects: [['persist', 'create', 'Task', { title: '@payload.title', ownerId: '@user.id' }]],
                },
                {
                  from: 'idle', to: 'idle', event: 'SAVE',
                  effects: [['persist', 'create', 'Task', { title: '@payload.title', ownerId: '@user.id' }]],
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

const ALICE = { id: 'alice', role: 'member' };

async function setup() {
  const runtime = new OrbitalServerRuntime({ kernel: await memoryKernel(), persistence: await nativeMemory(), debug: false });
  await runtime.register(schema());
  return runtime;
}

describeWithMemoryKernel('[pending-install: kernel.node TraitSurface.name, traitId, emits] OrbitalServerRuntime.dispatchExternalInput', () => {
  it('applies the entity policy to the session identity, never to a user the request names', async () => {
    const runtime = await setup();
    const res = await runtime.dispatchExternalInput('TaskOrbital', {
      targetTrait: 'TaskPersistor', event: 'DO_CREATE', payload: { title: 'Nope' }, user: ALICE,
    });
    expect(res.effectResults?.some((r) => r.denied === true)).toBe(true);
    expect(await runtime.persistence.list('Task')).toEqual([]);
  });

  it('control: the same input with no named user meets the same policy', async () => {
    const runtime = await setup();
    const res = await runtime.dispatchExternalInput('TaskOrbital', {
      targetTrait: 'TaskPersistor', event: 'DO_CREATE', payload: { title: 'Nope' },
    });
    expect(res.effectResults?.some((r) => r.denied === true)).toBe(true);
    expect(await runtime.persistence.list('Task')).toEqual([]);
  });

  it('refuses an event that is not a declared input, with a structured reason', async () => {
    const runtime = await setup();
    const res = await runtime.dispatchExternalInput('TaskOrbital', {
      targetTrait: 'TaskPersistor', event: 'SAVE', payload: { title: 'x' },
    });
    expect(res.success).toBe(false);
    expect(res.transitioned).toBe(false);
    expect(res.rejections).toEqual([{ code: 'not-an-external-input', trait: 'TaskPersistor', event: 'SAVE' }]);
    expect(await runtime.persistence.list('Task')).toEqual([]);
  });

  it('refuses an unknown trait or orbital the same way', async () => {
    const runtime = await setup();
    for (const [orbital, trait] of [['TaskOrbital', 'Nope'], ['Nope', 'TaskPersistor']] as const) {
      const res = await runtime.dispatchExternalInput(orbital, { targetTrait: trait, event: 'DO_CREATE', payload: {} });
      expect(res.rejections?.[0]?.code).toBe('not-an-external-input');
    }
  });

  it('lists the declared inputs', async () => {
    const runtime = await setup();
    expect(runtime.listExternalInputs().map((i) => `${i.orbital}.${i.trait}.${i.event}`)).toEqual([
      'TaskOrbital.TaskPersistor.DO_CREATE',
    ]);
  });

  it('control: the app\'s own event channel still delivers non-input events, under the same policy', async () => {
    const runtime = await setup();
    const res = await runtime.processOrbitalEvent('TaskOrbital', { event: 'SAVE', payload: { title: 'From UI' } });
    expect(res.effectResults?.some((r) => r.denied === true)).toBe(true);
    expect(await runtime.persistence.list('Task')).toEqual([]);
  });
});

describeWithMemoryKernel('[pending-install: kernel.node TraitSurface.name, traitId, emits] OrbitalServerRuntime with no program registered', () => {
  const bare = async () => new OrbitalServerRuntime({ kernel: await memoryKernel(), persistence: await nativeMemory(), debug: false });

  it('answers a typed not-an-external-input, never a thrown error', async () => {
    const res = await (await bare()).dispatchExternalInput('TaskOrbital', { targetTrait: 'TaskPersistor', event: 'DO_CREATE', payload: {} });
    expect(res.success).toBe(false);
    expect(res.rejections).toEqual([{ code: 'not-an-external-input', trait: 'TaskPersistor', event: 'DO_CREATE' }]);
  });

  it('answers an inbound delivery with the kernel\'s 404', async () => {
    const answer = await (await bare()).deliverInbound('hook', { headers: {}, rawBody: '{}' });
    expect(answer.status).toBe(404);
  });

  it('control: once a program is registered the same input is declared', async () => {
    const res = await (await setup()).dispatchExternalInput('TaskOrbital', { targetTrait: 'TaskPersistor', event: 'DO_CREATE', payload: { title: 'x' } });
    expect(res.rejections?.[0]?.code).not.toBe('not-an-external-input');
  });
});

describeWithMemoryKernel('[pending-install: kernel.node TraitSurface.name, traitId, emits] OrbitalServerRuntime.dispatchEventRequest (program/dispatch event requests)', () => {
  const tasks = async (runtime: OrbitalServerRuntime) =>
    (await runtime.persistence.list('Task')).map((row) => row['title']);

  it('dispatches any event as the session identity, ignoring a user the request names', async () => {
    const runtime = await setup();
    const answered = await runtime.dispatchEventRequest('TaskOrbital', { event: 'SAVE', targetTrait: 'TaskPersistor', payload: { title: 'by alice' }, user: ALICE }, false);
    expect(answered.ok && answered.response.effectResults?.some((r) => r.denied === true)).toBe(true);
    const control = await runtime.dispatchEventRequest('TaskOrbital', { event: 'SAVE', targetTrait: 'TaskPersistor', payload: { title: 'by nobody' } }, false);
    expect(control.ok && control.response.effectResults?.some((r) => r.denied === true)).toBe(true);
    expect(await tasks(runtime)).toEqual([]);
  });

  it('admits only a declared input when input is set', async () => {
    const runtime = await setup();
    const refused = await runtime.dispatchEventRequest('TaskOrbital', { event: 'SAVE', targetTrait: 'TaskPersistor', payload: { title: 'x' } }, true);
    expect(refused.ok && refused.response.rejections?.[0]?.code).toBe('not-an-external-input');
    const admitted = await runtime.dispatchEventRequest('TaskOrbital', { event: 'DO_CREATE', targetTrait: 'TaskPersistor', payload: { title: 'declared' } }, true);
    expect(admitted.ok && admitted.response.rejections?.[0]?.code).not.toBe('not-an-external-input');
  });

  it('fails an unknown orbital with the route code', async () => {
    const runtime = await setup();
    expect(await runtime.dispatchEventRequest('Nowhere', { event: 'SAVE', targetTrait: 'TaskPersistor' }, false))
      .toEqual({ ok: false, error: 'Orbital not found: Nowhere', code: 'ORBITAL_NOT_FOUND', status: 404 });
    const noTrait = await runtime.dispatchEventRequest('TaskOrbital', { event: 'DO_CREATE' }, true);
    expect(noTrait.ok === false && noTrait.code).toBe('NO_TRAIT');
  });
});

// Twin of `the_client_view_drops_an_emit_only_server_traits_listen_to` (orbital-core exec_dist/server_frame_echo.rs, EXEC-DIST-8):
// a `wire` answer is the kernel's client view, so an emit only server traits hear never reaches the browser.
describeWithMemoryKernel('OrbitalServerRuntime.dispatchEventRequest answers a browser the kernel client view (EXEC-DIST-8)', () => {
  const idle = (arms: Array<Record<string, unknown>>) => ({ states: [{ name: 'idle', isInitial: true }], transitions: arms });
  const handoff = (): OrbitalSchema => ({
    name: 'handoff-app',
    typeContractVersion: 1,
    version: '1.0.0',
    orbitals: [{
      name: 'Main',
      pages: [],
      entity: { name: 'Job', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      traits: [
        { name: 'Source', linkedEntity: 'Job', emits: [{ event: 'OUTSIDE', scope: 'external' }],
          stateMachine: idle([{ from: 'idle', to: 'idle', event: 'GO', effects: [['emit', 'HANDOFF', { blob: 'server-only-payload' }], ['emit', 'PAINT', { label: 'for-the-client' }], ['emit', 'OUTSIDE', {}]] }]) },
        { name: 'Sink', linkedEntity: 'Job', listens: [{ event: 'HANDOFF', triggers: 'TAKE', source: { kind: 'trait', trait: 'Source' } }],
          stateMachine: idle([{ from: 'idle', to: 'idle', event: 'TAKE', effects: [] }]) },
        { name: 'Painter', linkedEntity: 'Job', dispatch: 'client', listens: [{ event: 'PAINT', triggers: 'SHOW', source: { kind: 'trait', trait: 'Source' } }],
          stateMachine: idle([{ from: 'idle', to: 'idle', event: 'SHOW', effects: [] }]) },
      ],
    }],
  } as OrbitalSchema);
  const emitted = async (wire: boolean) => {
    const runtime = new OrbitalServerRuntime({ kernel: await memoryKernel(), persistence: await nativeMemory(), debug: false });
    await runtime.register(handoff());
    const answered = await runtime.dispatchEventRequest('Main', { event: 'GO', targetTrait: 'Source' }, false, false, wire);
    if (!answered.ok) throw new Error(answered.error);
    return answered.response.emittedEvents.map((e) => e.event);
  };

  it('a wire answer drops an emit only server traits listen to', async () => {
    expect(await emitted(true)).not.toContain('HANDOFF');
  });

  it('control: a wire answer keeps the emit a client trait hears and the external one', async () => {
    const names = await emitted(true);
    expect(names).toContain('PAINT');
    expect(names).toContain('OUTSIDE');
  });

  it('control: without wire the host answers the full response', async () => {
    expect(await emitted(false)).toContain('HANDOFF');
  });
});

// Twin of `the_client_view_keeps_a_server_traits_held_field_no_browser_step_reads_on_the_host` and its control (orbital-core
// exec_dist/server_frame_echo.rs, EXEC-DIST-8): a wire answer sends a session's frames narrowed to the fields the browser reads.
describeWithMemoryKernel('OrbitalServerRuntime.dispatchEventRequest sends a browser only the frame fields it reads (EXEC-DIST-8)', () => {
  const held = (): OrbitalSchema => ({
    name: 'held-app',
    typeContractVersion: 1,
    version: '1.0.0',
    orbitals: [{
      name: 'Main',
      pages: [],
      entity: { name: 'Box', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }, { name: 'blob', type: 'string' }, { name: 'label', type: 'string' }] },
      traits: [
        { name: 'Holder', linkedEntity: 'Box',
          stateMachine: { states: [{ name: 'idle', isInitial: true }], transitions: [
            { from: 'idle', to: 'idle', event: 'INIT', effects: [['call-service', 'mailer', 'send', { body: '@entity.blob' }, { emit: { success: 'TAKEN' } }]] },
            { from: 'idle', to: 'idle', event: 'TAKEN', effects: [] },
            { from: 'idle', to: 'idle', event: 'GO', effects: [['set', '@entity.blob', 'a-large-held-value'], ['set', '@entity.label', 'shown'], ['render-ui', 'main', { type: 'typography', content: 'Now @entity.label' }]] },
          ] } },
      ],
    }],
  } as OrbitalSchema);
  const holder = async (wire: boolean): Promise<Record<string, unknown>> => {
    const runtime = new OrbitalServerRuntime({ kernel: await memoryKernel(), persistence: await nativeMemory(), debug: false });
    await runtime.register(held());
    const answered = await runtime.dispatchEventRequest('Main', { event: 'GO', targetTrait: 'Holder' }, false, false, wire);
    if (!answered.ok) throw new Error(answered.error);
    const fields: Record<string, unknown> = {};
    for (const op of answered.response.frames?.ops ?? []) {
      if (op[0] === 'put' && op[1] === 'Holder') Object.assign(fields, op[2]);
      if (op[0] === 'set' && op[1].Holder) Object.assign(fields, op[1].Holder);
    }
    return fields;
  };

  it('a wire answer keeps a held field no browser step reads on the host', async () => {
    expect(await holder(true)).not.toHaveProperty('blob');
  });

  it('control: a wire answer keeps the field a render reads, and without wire every written field', async () => {
    expect(await holder(true)).toHaveProperty('label', 'shown');
    expect(await holder(false)).toHaveProperty('blob', 'a-large-held-value');
  });
});

describeWithMemoryKernel('OrbitalServerRuntime program/resolve-rows (rows resolve for the requesting session's identity, EXEC-IDENTITY-1)', () => {
  const OWNED: SExpr = ['=', ['object/get', '@entity', 'ownerId'], '@user.id'];
  const ownedNotes = async () => {
    const runtime = new OrbitalServerRuntime({ kernel: await memoryKernel(), persistence: await nativeMemory(), debug: false });
    await runtime.register({
      name: 'ResolveApp',
      typeContractVersion: 1,
      version: '1.0.0',
      orbitals: [{
        name: 'Notes',
        pages: [],
        entity: {
          name: 'Note', persistence: 'persistent', read_policy: OWNED,
          fields: [{ name: 'id', type: 'string', primaryKey: true }, { name: 'ownerId', type: 'string' }],
        },
        traits: [{
          name: 'NoteBrowse', linkedEntity: 'Note',
          stateMachine: { states: [{ name: 'idle', isInitial: true }], transitions: [{ from: 'idle', to: 'idle', event: 'LIST' }] },
        }],
      }],
    });
    for (const [id, ownerId] of [['a1', 'alice'], ['a2', 'alice'], ['b1', 'bob']]) await runtime.persistence.create('Note', { id, ownerId });
    return runtime;
  };
  const reference = { entityType: 'Note', ids: ['a1', 'b1', 'a2'], total: 3, query: {} };
  const ids = (page: { rows: ReadonlyArray<{ id?: unknown }> }) => page.rows.map((row) => row.id);

  it('answers only the rows the anonymous viewer may read when the session bound no identity', async () => {
    const runtime = await ownedNotes();
    const ports = runtime.servicePorts({ orbital: 'Notes', trait: 'NoteBrowse' }, undefined, () => {});
    const anonymous = await ports.resolveRows?.(reference, undefined);
    expect(anonymous && ids(anonymous)).toEqual([]);
    expect(anonymous?.total).toBe(0);
    const unbound = await ports.resolveRows?.(reference, 'tab-without-identity');
    expect(unbound && ids(unbound)).toEqual([]);
  });

  it('fails a reference naming an entity no orbital declares', async () => {
    const runtime = await ownedNotes();
    await expect(runtime.resolveRows({ ...reference, entityType: 'Nothing' }, undefined)).rejects.toThrow('no registered orbital declares this entity');
  });
});
