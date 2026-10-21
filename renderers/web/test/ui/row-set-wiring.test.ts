/**
 * S8-wire: the store's one resolver, the loading state of an unresolved reference, and the rows-changed signal.
 */
import { describe, it, expect } from 'vitest';
import { ANONYMOUS_USER, ROW_SET_MARKER, runRowQuery, type Entity, type EntityRow, type SExpr, type UserContext, type PersistenceAdapter, type RowQuery, type RowSetMarker, type RowSetRef } from '@almadar/core';
import { resolveRenderBindingMarkers } from '../../src/lib/resolve-render-bindings';
import { createCircuitRowSetResolver } from '../../src/lib/store-row-set-resolver';
import { notifyRowsChanged } from '../../src/lib/rows-changed';
import { viewerReadPolicy } from '../../src/lib/viewer-read-policy';
import { createRowSetResolver, type RowSetResolver } from '../../src/lib/row-set-resolver';
import type { SlotProps } from '../../src/providers/UISlotContext';

const rowsOf = (n: number): EntityRow[] => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, title: `T${i + 1}` }));
const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const ref = (ids: string[], total: number): RowSetRef => ({ entityType: 'Task', ids, total, query: {} });
const marker = (r: RowSetRef): RowSetMarker => ({ [ROW_SET_MARKER]: true, ref: r });
const walk = (props: SlotProps, resolver: ReturnType<typeof createRowSetResolver> | undefined) => {
  const out = resolveRenderBindingMarkers(props, 'Board', {}, undefined, 'idle', undefined, resolver);
  if (typeof out === 'string') throw new Error('expected props');
  return out;
};
const queryPageOf = (tables: Record<string, EntityRow[]>) => async (entityType: string, query: RowQuery) => runRowQuery(tables[entityType] ?? [], query);

describe('createCircuitRowSetResolver (browser store)', () => {
  it('builds a resolver over a store that can queryPage', async () => {
    const tables = { Task: rowsOf(3) };
    const store: Pick<PersistenceAdapter, 'queryPage'> = { queryPage: queryPageOf(tables) };
    const resolver = createCircuitRowSetResolver({ browser: { store: store as PersistenceAdapter, entityTypes: new Set(['Task']) } });
    expect(resolver).toBeDefined();
    resolver?.resolve(ref(['t2'], 3));
    await settle();
    expect(resolver?.resolve(ref(['t2'], 3)).rows.map((r) => r.id)).toEqual(['t2']);
  });

  it('control: a store with no queryPage gets no resolver, so markers stay raw', () => {
    const store: Pick<PersistenceAdapter, 'queryPage'> = {};
    expect(createCircuitRowSetResolver({ browser: { store: store as PersistenceAdapter, entityTypes: new Set(['Task']) } })).toBeUndefined();
    const props: SlotProps = { entity: marker(ref(['t1'], 1)) };
    expect(walk(props, undefined)).toBe(props);
  });
});

describe('loading state of an unresolved reference', () => {
  it('flags the owning pattern isLoading until the rows arrive, then clears it', async () => {
    const resolver = createRowSetResolver({ store: { queryPage: queryPageOf({ Task: rowsOf(3) }) } });
    const props: SlotProps = { type: 'data-table', entity: marker(ref(['t1', 't2'], 3)) };
    const first = walk(props, resolver);
    expect(first.entity).toEqual([]);
    expect(first.isLoading).toBe(true);
    await settle();
    const settled = walk(props, resolver);
    expect((settled.entity as EntityRow[]).map((r) => r.id)).toEqual(['t1', 't2']);
    expect(settled.isLoading).toBeUndefined();
  });

  it('flags a nested pattern node, not its siblings', () => {
    const resolver = createRowSetResolver({ store: { queryPage: queryPageOf({ Task: rowsOf(3) }) } });
    const props: SlotProps = {
      type: 'stack',
      children: [{ type: 'data-table', entity: marker(ref(['t1'], 1)) }, { type: 'text', content: 'hi' }],
    };
    const out = walk(props, resolver);
    const [table, text] = out.children as Array<Record<string, unknown>>;
    expect(table.isLoading).toBe(true);
    expect(text.isLoading).toBeUndefined();
    expect(out.isLoading).toBeUndefined();
  });

  it('shows loading again while a rows-changed refresh is in flight', async () => {
    const tables = { Task: rowsOf(2) };
    const resolver = createRowSetResolver({ store: { queryPage: queryPageOf(tables) } });
    const props: SlotProps = { entity: marker(ref(['t1'], 2)) };
    walk(props, resolver);
    await settle();
    expect(walk(props, resolver).isLoading).toBeUndefined();
    resolver.rowsChanged('Task');
    expect(walk(props, resolver).isLoading).toBe(true);
    await settle();
    expect(walk(props, resolver).isLoading).toBeUndefined();
  });
});

describe('rows-changed repaint (EXEC-RENDER-3)', () => {
  const rowsChangedCalls = () => {
    const calls: string[] = [];
    const resolver: RowSetResolver = { resolve: () => ({ rows: [], total: 0, loading: false }), rowsChanged: (t) => calls.push(t), subscribe: () => () => undefined, epoch: () => 0 };
    return { calls, resolver };
  };
  const taskTable: SlotProps = { type: 'data-table', entity: marker(ref(['t1'], 1)) };

  it('names the entity types of every reference the repainted content holds', () => {
    const { calls, resolver } = rowsChangedCalls();
    notifyRowsChanged(resolver, { type: 'stack', children: [taskTable, { type: 'list', entity: marker({ ...ref(['u1'], 1), entityType: 'User' }) }] });
    expect(calls.sort()).toEqual(['Task', 'User']);
  });

  it('control: content with no reference re-resolves nothing', () => {
    const { calls, resolver } = rowsChangedCalls();
    notifyRowsChanged(resolver, { type: 'text', content: 'hi', entity: [{ id: 'a' }] });
    expect(calls).toEqual([]);
  });

  it('control: no resolver is a no-op', () => {
    expect(() => notifyRowsChanged(undefined, taskTable)).not.toThrow();
  });
});

describe('viewer @read policy', () => {
  const owned: SExpr = ['=', '@entity.owner', '@user.id'];
  const entity = { name: 'Task', fields: [{ name: 'id', type: 'string', required: true }, { name: 'owner', type: 'string', required: true }], read_policy: owned } as Entity;
  const tables = { Task: [{ id: 't1', owner: 'u1' }, { id: 't2', owner: 'u2' }, { id: 't3', owner: 'u1' }] };
  const viewerOf = (id: string): UserContext => ({ ...ANONYMOUS_USER, id, role: 'user' });
  const resolveFor = async (id: string) => {
    const store: Pick<PersistenceAdapter, 'queryPage'> = { queryPage: queryPageOf(tables) };
    const resolver = createCircuitRowSetResolver({ browser: { store: store as PersistenceAdapter, entityTypes: new Set(['Task']), policy: viewerReadPolicy([entity], viewerOf(id)) } });
    const r = ref(['t1', 't2', 't3'], 3);
    resolver?.resolve(r);
    await settle();
    return resolver?.resolve(r);
  };

  it('omits a row the viewer cannot read and re-counts the total', async () => {
    const res = await resolveFor('u2');
    expect(res?.rows.map((x) => x.id)).toEqual(['t2']);
    expect(res?.total).toBe(1);
  });

  it('control: the owner of two rows sees those two', async () => {
    const res = await resolveFor('u1');
    expect(res?.rows.map((x) => x.id)).toEqual(['t1', 't3']);
    expect(res?.total).toBe(2);
  });

  it('control: an entity declaring no @read has no policy', () => {
    expect(viewerReadPolicy([{ ...entity, read_policy: undefined }], viewerOf('u1'))('Task')).toBeUndefined();
  });
});
