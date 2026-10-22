import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EntityRowSchema, JsonValueSchema, OrbitalSchemaSchema, eventPayloadOf, isJsonObject, orbitalInlineEntities, type EventPayload, type KernelMemoryStoreExports, type OrbitalSchema, type QueryCapabilities } from '@almadar/core';
import { KernelEngine } from '../src/kernel/engine.js';
import type { KernelModule } from '../src/kernel/wire.js';
import type { KernelHostPorts } from '../src/kernel/host.js';
import { InFlightCalls } from '../src/effects/in-flight-calls.js';
import { NativeMemoryPersistenceAdapter } from '../src/persistence/native-memory.js';

const require = createRequire(import.meta.url);

function program(name: string, entityName: string, command: string): OrbitalSchema {
  return OrbitalSchemaSchema.parse({
    name,
    osGrants: { exec: [command] },
    orbitals: [{
      name: `${name}Orbital`,
      entity: {
        name: entityName,
        persistence: 'runtime',
        fields: [{ name: 'id', type: 'string' }],
        ...(name === 'App' ? { create_policy: ['=', ['object/get', '@entity', 'ownerId'], '@user.id'] } : {}),
      },
      auxiliaryEntities: [{ name: `${name}Aux`, persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] }],
      traits: [{
        name: `${name}Trait`,
        linkedEntity: entityName,
        scope: 'instance',
        stateMachine: {
          events: [{ key: 'GO', name: 'GO' }],
          states: [{ name: 'idle', isInitial: true }, { name: 'done' }],
          transitions: [{ from: 'idle', to: 'done', event: 'GO', effects: name === 'App' ? [] : [
            ['access-check', { entity: 'Note', action: 'create', row: { ownerId: 'owner' }, viewer: '@payload.viewer' }, { emit: { success: 'CHECKED', failure: 'FAILED' } }],
          ] }],
        },
      }],
    }],
  });
}

function ports(persistence: NativeMemoryPersistenceAdapter): KernelHostPorts {
  return {
    persistence,
    inFlightCalls: new InFlightCalls(),
    callService: async () => null,
    programEffect: () => undefined,
    servicePorts: () => { throw new Error('unexpected service call'); },
    deliverLive: () => undefined,
    deferCallOutcome: () => undefined,
  };
}

const implementations = [
  { name: 'native Node', path: process.env.ORBITAL_KERNEL_NODE },
  { name: 'WASM', path: process.env.ORBITAL_KERNEL_MEMORY_WASM },
];

for (const implementation of implementations) {
  describe.skipIf(!implementation.path)(`KernelEngine.forkProgram (${implementation.name})`, () => {
    it('retains app policy context through child fork/reset and isolates routes and grants', async () => {
      if (!implementation.path) throw new Error('a real kernel module path is required');
      const kernel: KernelModule & KernelMemoryStoreExports = require(implementation.path);
      const declared: string[] = [];
      class Persistence extends NativeMemoryPersistenceAdapter {
        override queryCapabilities(entityType: string): QueryCapabilities {
          declared.push(entityType);
          return super.queryCapabilities(entityType);
        }
      }
      const persistence = new Persistence(new kernel.MemoryStore());
      const app = KernelEngine.open(kernel, program('App', 'Note', 'parent-only'), ports(persistence));
      const child = app.forkProgram(program('Control', 'ControlRow', 'child-only'));
      const fork = child.fork();
      try {
        expect(new Set(declared)).toEqual(new Set(['Note', 'AppAux', 'ControlRow', 'ControlAux']));
        for (const current of [child, fork]) {
          expect(current.stateOf('AppTrait')).toBe('');
          expect(current.osAllows(JSON.stringify({ need: 'exec', command: 'child-only' }))).toBe(true);
          expect(current.osAllows(JSON.stringify({ need: 'exec', command: 'parent-only' }))).toBe(false);
          for (const viewer of [{ id: 'owner' }, { id: 'other' }]) {
            const response = await current.evaluate('ControlOrbital', { event: 'GO', payload: { viewer } }, { orbital: 'ControlOrbital' });
            expect(response.emittedEvents.find((event) => event.event === 'CHECKED')?.payload).toEqual({ allowed: viewer.id === 'owner' });
            expect(current.stateOf('ControlTrait')).toBe('done');
            current.reset();
            expect(current.stateOf('ControlTrait')).toBe('idle');
            expect(current.osAllows(JSON.stringify({ need: 'exec', command: 'child-only' }))).toBe(true);
            expect(current.osAllows(JSON.stringify({ need: 'exec', command: 'parent-only' }))).toBe(false);
          }
        }
        expect(app.stateOf('AppTrait')).toBe('idle');
        expect(app.stateOf('ControlTrait')).toBe('');
        expect(app.osAllows(JSON.stringify({ need: 'exec', command: 'parent-only' }))).toBe(true);
      } finally {
        fork.dispose();
        child.dispose();
        app.dispose();
      }
    });
    it.skipIf(!process.env.ORBITAL_STD_MOCK_SEED)('runs the real std dataset program with shared policies and locale instances', async () => {
      if (!implementation.path || !process.env.ORBITAL_STD_MOCK_SEED) throw new Error('real kernel and resolved std seed program paths are required');
      const kernel: KernelModule & KernelMemoryStoreExports = require(implementation.path);
      const seedProgram = OrbitalSchemaSchema.parse(JSON.parse(readFileSync(process.env.ORBITAL_STD_MOCK_SEED, 'utf8')));
      const appProgram = OrbitalSchemaSchema.parse({ name: 'SeededApp', orbitals: [{
        name: 'Main',
        entity: { name: 'User', collection: 'users', persistence: 'persistent', identity: true,
          fields: [{ name: 'id', type: 'string', required: true }], instances: [{ id: 'viewer' }] },
        auxiliaryEntities: [{ name: 'Task', collection: 'tasks', persistence: 'persistent',
          fields: [{ name: 'id', type: 'string', required: true }, { name: 'title', type: 'string', required: true },
            { name: 'ownerId', type: 'string', relation: { entity: 'User', cardinality: 'many-to-one' } }],
          create_policy: ['=', ['object/get', '@entity', 'ownerId'], '@user.id'],
          read_policy: ['=', ['object/get', '@entity', 'ownerId'], '@user.id'],
        }, { name: 'LocalNote', collection: 'notes', persistence: 'persistent', local: true,
          fields: [{ name: 'id', type: 'string', required: true }, { name: 'title', type: 'string', required: true }],
          instances: [{ id: 'default', title: 'Default' }],
          localeInstances: { ar: [{ id: 'arabic', title: 'عربي' }], empty: [] },
        }], traits: [],
      }] });
      const persistence = new NativeMemoryPersistenceAdapter(new kernel.MemoryStore());
      persistence.bindCollection('User', 'users');
      persistence.bindCollection('Task', 'tasks');
      const app = KernelEngine.open(kernel, appProgram, ports(persistence));
      const seed = app.forkProgram(seedProgram);
      try {
        for (const [locale, expectedId] of [[undefined, 'default'], ['ar', 'arabic'], ['empty', undefined]]) {
          const payload = eventPayloadOf(JsonValueSchema.parse(JSON.parse(JSON.stringify({
            program: appProgram, count: 1, seed: 42, nowMs: 1780272000000, viewerId: 'viewer',
            ownerPairs: [{ entity: 'Task', column: 'ownerId' }], ...(locale === undefined ? {} : { locale }),
          }))));
          const response = await seed.evaluate('MockSeedOrbital', { event: 'DATASET_INPUT', targetTrait: 'MockSeed', payload }, { orbital: 'MockSeedOrbital', user: { id: 'viewer' } });
          expect(response.success).toBe(true);
          expect(response.emittedEvents.filter((event) => ['DATASET_FAILED', 'DS_OWNS_ENV', 'DS_OWNS_ENV_FAILED'].includes(event.event))).toEqual([]);
          const dataset = JsonValueSchema.parse(response.emittedEvents.find((event) => event.event === 'DATASET_DONE')?.payload);
          if (!isJsonObject(dataset) || !isJsonObject(dataset.stores)) throw new Error('std seed must return dataset stores');
          const tasks = EntityRowSchema.array().parse(dataset.stores.tasks);
          expect(tasks).toHaveLength(1);
          if (expectedId === undefined) expect(dataset.stores).not.toHaveProperty('notes');
          else expect(EntityRowSchema.array().parse(dataset.stores.notes).map((row) => row.id)).toEqual([expectedId]);
          for (const row of tasks) expect(row.ownerId).toBe('viewer');
          const users = EntityRowSchema.array().parse(dataset.stores.users);
          expect(users[0]?.id).toBe('viewer');
          for (const row of tasks) await persistence.writeWhere({ kind: 'upsert', entityType: 'Task', data: row });
          const taskId = tasks[0]?.id;
          if (taskId === undefined) throw new Error('std seed must assign task id');
          const reference = { entityType: 'Task', ids: [taskId], total: 1, query: {} };
          expect((await app.resolveRows(reference, { orbital: 'Main', user: { id: 'viewer' } })).rows.map((row) => row.id)).toEqual([taskId]);
          expect((await app.resolveRows(reference, { orbital: 'Main', user: { id: 'other' } })).rows).toEqual([]);
          seed.reset();
          persistence.clear();
        }
      } finally {
        seed.dispose();
        app.dispose();
      }
    });
  });
}

for (const implementation of implementations) {
  it.skipIf(!implementation.path || !process.env.ORBITAL_STD_DEPLOYMENT_REGISTRY)(`runs the canonical deployment registry against real storage (${implementation.name})`, async () => {
    if (!implementation.path || !process.env.ORBITAL_STD_DEPLOYMENT_REGISTRY) throw new Error('real kernel and resolved std deployment program paths are required');
    const kernel: KernelModule & KernelMemoryStoreExports = require(implementation.path);
    const schema = OrbitalSchemaSchema.parse(JSON.parse(readFileSync(process.env.ORBITAL_STD_DEPLOYMENT_REGISTRY, 'utf8')));
    const persistence = new NativeMemoryPersistenceAdapter(new kernel.MemoryStore());
    for (const entity of schema.orbitals.flatMap(orbitalInlineEntities)) {
      if (entity.collection !== undefined) persistence.bindCollection(entity.name, entity.collection);
    }
    const engine = KernelEngine.open(kernel, schema, ports(persistence));
    async function dispatch(event: string, payload: EventPayload, answer: string): Promise<EventPayload | undefined> {
      const response = await engine.evaluate('DeploymentRegistryOrbital', { event, targetTrait: 'DeploymentRegistrar', payload }, { orbital: 'DeploymentRegistryOrbital' });
      expect(response.success).toBe(true);
      expect(response.transitioned).toBe(true);
      const emitted = response.emittedEvents.find((item) => item.event === answer);
      expect(emitted, `expected ${answer} after ${event}`).toBeDefined();
      return emitted?.payload;
    }
    try {
      expect(await dispatch('RESOLVE', { artifact: 'app' }, 'RESOLVED')).toMatchObject({ artifact: 'app', found: false });
      for (const [activates, commit, version] of [[true, 'one', 1], [false, 'two', 2], [true, 'three', 3]] satisfies [boolean, string, number][]) {
        expect(await dispatch('DEPLOY', { artifact: 'app', activates, details: { commit } }, 'DEPLOYED')).toEqual({ artifact: 'app', version });
        expect(await persistence.getById('Deployment', `app#${version}`)).toMatchObject({ artifact: 'app', version, activates, details: { commit } });
        expect(await persistence.getById('DeploymentCounter', 'app')).toMatchObject({ last: version });
        expect(await persistence.getById('ActiveDeployment', 'app')).toMatchObject({ version: activates ? version : 1 });
      }
      console.info('deployment:persist passed: atomic counter/history/active rows, inactive export preserves active pointer');
      await dispatch('DEPLOY', { artifact: 'other', activates: true, details: { commit: 'other' } }, 'DEPLOYED');
      expect(await dispatch('RESOLVE', { artifact: 'app' }, 'RESOLVED')).toMatchObject({ artifact: 'app', found: true, version: 3, details: { commit: 'three' } });
      console.info('deployment:resolve passed: actual stored active pointer and details');
      const history = await dispatch('HISTORY', { artifact: 'app' }, 'HISTORY_ANSWERED');
      const deployments = EntityRowSchema.array().parse(history?.deployments);
      expect(deployments.map((row) => row.version)).toEqual([1, 2, 3]);
      expect(deployments.map((row) => row.artifact)).toEqual(['app', 'app', 'app']);
      console.info('deployment:history passed: scoped ordered versions exclude other artifact');
      expect(await dispatch('ROLLBACK', { artifact: 'app', version: 1 }, 'ROLLED_BACK')).toEqual({ artifact: 'app', version: 1 });
      expect(await persistence.getById('ActiveDeployment', 'app')).toMatchObject({ version: 1, details: { commit: 'one' } });
      expect(await dispatch('ROLLBACK', { artifact: 'app', version: 2 }, 'ROLLBACK_FAILED')).toMatchObject({ code: 'not-activatable' });
      expect(await dispatch('ROLLBACK', { artifact: 'app', version: 99 }, 'ROLLBACK_FAILED')).toMatchObject({ code: 'not-recorded' });
      expect(await persistence.getById('ActiveDeployment', 'app')).toMatchObject({ version: 1 });
      expect(await persistence.getById('DeploymentCounter', 'app')).toMatchObject({ last: 3 });
      console.info('deployment:rollback passed: serving version restored; inactive/missing controls preserve active and history');
      await dispatch('WITHDRAW', { artifact: 'app' }, 'WITHDRAWN');
      expect(await persistence.getById('ActiveDeployment', 'app')).toBeNull();
      expect(await dispatch('RESOLVE', { artifact: 'app' }, 'RESOLVED')).toMatchObject({ found: false });
      expect(await dispatch('DEPLOY', { artifact: 'app', activates: true, details: { commit: 'four' } }, 'DEPLOYED')).toMatchObject({ version: 4 });
      expect(await persistence.getById('DeploymentCounter', 'app')).toMatchObject({ last: 4 });
      console.info('deployment:withdraw passed: history survives and next deployment remains monotonic');
      expect(await persistence.writeWhere({ kind: 'create', entityType: 'Deployment', data: { id: 'contended#1', artifact: 'contended', version: 1, activates: false, details: {} } })).toMatchObject({ kind: 'created' });
      expect(await dispatch('DEPLOY', { artifact: 'contended', activates: true, details: { commit: 'blocked' } }, 'DEPLOY_FAILED')).toMatchObject({ code: 'contended' });
      expect(await persistence.getById('DeploymentCounter', 'contended')).toBeNull();
      expect(await persistence.getById('ActiveDeployment', 'contended')).toBeNull();
      expect(await persistence.getById('Deployment', 'contended#1')).toMatchObject({ activates: false });
      console.info('deployment:atomic-failure passed: real duplicate exhausts retries with no partial counter/active writes');
    } finally {
      engine.dispose();
    }
  });
}
