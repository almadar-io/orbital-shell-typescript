/**
 * `KernelEngine.resolveRows`: a row-set reference resolved through the host-answered store. The kernel (a scripted
 * handle here, standing in for the wasm `Server`; the Rust twin is `orbital-core/tests/server_resolve_rows.rs`) asks
 * for the by-id window and the re-count; the host answers them from its persistence and the engine returns the page.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryPersistence } from '@almadar/db/mock';
import { type EventStreamItem, type EntityRow, type RowSetRef } from '@almadar/core';
import { InFlightCalls } from '../src/effects/in-flight-calls.js';
import { KernelEngine } from '../src/kernel/engine.js';
import type { KernelHostPorts } from '../src/kernel/host.js';
import type { KernelModule, KernelServerHandle } from '../src/kernel/wire.js';
import { stubKernelModule } from '../src/test-support/stub-kernel-module.js';

const reference: RowSetRef = {
  entityType: 'Ticket',
  ids: ['t2', 't5'],
  total: 4,
  query: { filter: { kind: 'compare', field: 'status', op: '==', value: 'open' }, limit: 2 },
};

const ROWS: EntityRow[] = [
  { id: 't1', status: 'open' }, { id: 't2', status: 'open' }, { id: 't3', status: 'open' }, { id: 't5', status: 'open' },
];

const ports = (persistence: InMemoryPersistence): KernelHostPorts => ({
  persistence,
  inFlightCalls: new InFlightCalls(),
  callService: async () => null,
  programEffect: () => undefined,
  servicePorts: (caller, _user, message) => ({ caller, message, inputs: () => [], readableEntities: () => [], dispatchInput: async () => { throw new Error('no input channel'); }, read: async () => [] }),
  deliverLive: () => undefined,
  deferCallOutcome: () => undefined,
});

/** A kernel that resolves by asking for two reads and folding the answers, as the Rust resolve does. */
function scripted(log: string[], service = false): KernelModule {
  class Handle implements KernelServerHandle {
    private answers: string[] = [];
    resolveRows(_ref: string, _viewer: string): string {
      log.push('resolveRows');
      return JSON.stringify({ status: 'await', flight: 7, requests: [{ id: 0, request: { kind: 'listRows', entityType: 'Ticket' } }] });
    }
    resumeResolve(flight: number, repliesJson: string): string {
      log.push(`resumeResolve ${flight}`);
      const [reply] = JSON.parse(repliesJson);
      this.answers.push(JSON.stringify(reply.answer));
      const rows: EntityRow[] = reply.answer.result.ok;
      return JSON.stringify({ status: 'done', rows: rows.filter((r) => reference.ids.includes(String(r.id))), total: rows.length });
    }
    abandon(flight: number): boolean { log.push(`abandon ${flight}`); return true; }
    start(_orbital: string, request: string): string {
      log.push(`start ${JSON.parse(request).event}`);
      if (service) return JSON.stringify({ status: 'await', flight: 1, requests: [{ id: 0, request: { kind: 'callService', service: 'test', method: 'again', args: {}, site: { orbital: 'Main', trait: 'Worker', followOn: false, emit: {} } } }] });
      return JSON.stringify({ status: 'await', flight: 1, requests: [{ id: 0, request: { kind: 'listRows', entityType: 'Ticket' } }] });
    }
    resume(_flight: number, replies: string): string {
      log.push('resume');
      if (service) log.push(JSON.parse(replies)[0].answer.result.error);
      return JSON.stringify({ status: 'done', response: { success: true, transitioned: true, states: {}, emittedEvents: [] } });
    }
    liveItemDelivered(): boolean { return true; }
    dispatchStream(): string {
      log.push('stream');
      return JSON.stringify([
        { type: 'event', data: { event: 'FIRST' }, timestamp: 1 },
        { type: 'effect', data: ['navigate', '/next'], timestamp: 2 },
        { type: 'event', data: { event: 'LAST' }, timestamp: 3 },
        { type: 'complete', data: { success: true, transitioned: true, states: {}, emittedEvents: [] }, timestamp: 4 },
      ]);
    }
    inFlight(): number { return 0; }
    getState(): string { return ''; }
    setDefaultUser(): void {}
    mount(): void {}
    remount(): void {}
    setTickMount(): void {}
    seedRuntimeMock(): void {}
    setCapabilities(): void {}
    setMessages(): void {}
    setManagedProgram(): void {}
    lastError(): string { return ''; }
    osAllows(): boolean { return false; }
    fork(): KernelServerHandle { throw new Error('unused'); }
    free(): void {}
  }
  return stubKernelModule(Handle);
}

describe('KernelEngine.resolveRows', () => {
  it('answers the kernel\'s reads from the host store and returns the resolved page', async () => {
    const persistence = new InMemoryPersistence();
    for (const row of ROWS) await persistence.create('Ticket', { ...row });
    const log: string[] = [];
    const engine = new KernelEngine(scripted(log), '{}', ports(persistence));
    const page = await engine.resolveRows(reference, { orbital: 'Main', user: { id: 'u1', role: 'member' } });
    expect(page.rows.map((r) => r.id)).toEqual(['t2', 't5']);
    expect(page.total).toBe(4);
    expect(log).toEqual(['resolveRows', 'resumeResolve 7']);
  });

  it('a row deleted since the fetch is omitted and the total follows the store', async () => {
    const persistence = new InMemoryPersistence();
    for (const row of ROWS) await persistence.create('Ticket', { ...row });
    await persistence.delete('Ticket', 't2');
    const engine = new KernelEngine(scripted([]), '{}', ports(persistence));
    const page = await engine.resolveRows(reference, { orbital: 'Main' });
    expect(page.rows.map((r) => r.id)).toEqual(['t5']);
    expect(page.total).toBe(3);
  });
});


it('reads the canonical ordered stream before another dispatch starts; plain calls do not read it', async () => {
  const log: string[] = [];
  const items: EventStreamItem[] = [];
  const engine = new KernelEngine(scripted(log), '{}', ports(new InMemoryPersistence()));
  await Promise.all([
    engine.evaluate('Main', { event: 'FIRST' }, { orbital: 'Main', onStream: (item) => { items.push(item); log.push(`item ${item.type}`); } }),
    engine.evaluate('Main', { event: 'SECOND' }, { orbital: 'Main' }),
  ]);
  expect(items.map((item) => item.type)).toEqual(['event', 'effect', 'event', 'complete']);
  expect(log).toEqual(['start FIRST', 'resume', 'stream', 'item event', 'item effect', 'item event', 'item complete', 'start SECOND', 'resume']);
});


it('refuses a service reentering its parked turn instead of waiting on itself', async () => {
  const log: string[] = [];
  const base = ports(new InMemoryPersistence());
  const host: KernelHostPorts = {
    ...base,
    servicePorts: (caller, user, message, assertReentry) => ({ ...base.servicePorts(caller, user, message), dispatchInput: async () => { assertReentry?.(); throw new Error('should not reach dispatch'); } }),
    callService: async (_service, _method, _args, context) => {
      await context?.host?.dispatchInput('Main', { targetTrait: 'Worker', event: 'AGAIN' });
      return null;
    },
  };
  const engine = new KernelEngine(scripted(log, true), '{}', host);
  await engine.evaluate('Main', { event: 'ASK' }, { orbital: 'Main' });
  expect(log).toEqual(['start ASK', 'resume', 'dispatch #0 (ASK) is parked holding the dispatch lane on this thread; resume or drop it before starting another dispatch']);
});
