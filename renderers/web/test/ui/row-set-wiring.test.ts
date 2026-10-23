/**
 * S8-wire: the store's one resolver, the loading state of an unresolved reference, and the rows-changed signal.
 */
import { describe, it, expect } from 'vitest';
import { ROW_SET_MARKER, type EntityRow, type RowQueryPage, type RowSetMarker, type RowSetRef } from '@almadar/core';
import { resolveRenderBindingMarkers } from '../../src/lib/resolve-render-bindings';
import { createCircuitRowSetResolver } from '../../src/lib/store-row-set-resolver';
import { notifyRowsChanged } from '../../src/lib/rows-changed';
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
/** A stand-in for the kernel that holds the rows: the ref's ids still present, the total re-counted. */
const kernelOf = (tables: Record<string, EntityRow[]>) => async (r: RowSetRef): Promise<RowQueryPage> => {
  const held = tables[r.entityType] ?? [];
  const byId = new Map(held.map((row) => [String(row.id), row]));
  return { rows: r.ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as EntityRow] : [])), total: held.length };
};

describe('createCircuitRowSetResolver (browser store)', () => {
  it('builds a resolver over the kernel opened on the browser store', async () => {
    const tables = { Task: rowsOf(3) };
    const resolver = createCircuitRowSetResolver({ browser: { resolve: kernelOf(tables), entityTypes: new Set(['Task']) } });
    expect(resolver).toBeDefined();
    resolver?.resolve(ref(['t2'], 3));
    await settle();
    expect(resolver?.resolve(ref(['t2'], 3)).rows.map((r) => r.id)).toEqual(['t2']);
  });

  it('control: no kernel and no server gives no resolver, so markers stay raw', () => {
    expect(createCircuitRowSetResolver({})).toBeUndefined();
    const props: SlotProps = { entity: marker(ref(['t1'], 1)) };
    expect(walk(props, undefined)).toBe(props);
  });
});

describe('loading state of an unresolved reference', () => {
  it('flags the owning pattern isLoading until the rows arrive, then clears it', async () => {
    const resolver = createRowSetResolver({ resolve: kernelOf({ Task: rowsOf(3) }) });
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
    const resolver = createRowSetResolver({ resolve: kernelOf({ Task: rowsOf(3) }) });
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
    const resolver = createRowSetResolver({ resolve: kernelOf(tables) });
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
