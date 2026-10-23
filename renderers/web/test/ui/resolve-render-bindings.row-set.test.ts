/**
 * RowSetMarker leaves (Speed Design 5.3-5.5): resolved at paint time through the ONE resolver, in the same walker
 * as RenderBindingMarker. Pins: marker resolves to rows in ref order; a hidden/deleted row is omitted and the total
 * re-counted (Q6); a write to the entity re-resolves (Q7, EXEC-RENDER-3); no marker -> original props identity.
 */
import { describe, it, expect } from 'vitest';
import {
  ROW_SET_MARKER,
  type EntityRow,
  type RowQueryPage,
  type RowSetMarker,
  type RowSetRef,
} from '@almadar/core';
import { resolveRenderBindingMarkers } from '../../src/lib/resolve-render-bindings';
import { createRowSetResolver } from '../../src/lib/row-set-resolver';
import type { SlotProps } from '../../src/providers/UISlotContext';

/** A stand-in for the kernel that holds the rows: the ref's ids still present and not hidden from the viewer, the total re-counted. */
function kernelRows(initial: EntityRow[], hidden: ReadonlySet<string> = new Set()) {
  const tables: Record<string, EntityRow[]> = { Task: initial };
  return {
    tables,
    async resolve(r: RowSetRef): Promise<RowQueryPage> {
      const visible = (tables[r.entityType] ?? []).filter((row) => !hidden.has(String(row.id)));
      const byId = new Map(visible.map((row) => [String(row.id), row]));
      return { rows: r.ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as EntityRow] : [])), total: visible.length };
    },
  };
}

const ref = (ids: string[], total: number): RowSetRef => ({ entityType: 'Task', ids, total, query: {} });
const marker = (r: RowSetRef): RowSetMarker => ({ [ROW_SET_MARKER]: true, ref: r });
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

const rows = (n: number): EntityRow[] => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, title: `T${i + 1}`, open: true }));
const walk = (props: SlotProps, resolver: ReturnType<typeof createRowSetResolver>) => {
  const out = resolveRenderBindingMarkers(props, 'Board', {}, undefined, 'idle', undefined, resolver);
  if (typeof out === 'string') throw new Error('expected props');
  return out;
};

describe('RowSetMarker resolution', () => {
  it('resolves the marker to the rows in ref order once the store answers', async () => {
    const kernel = kernelRows(rows(5));
    const resolver = createRowSetResolver({ resolve: kernel.resolve });
    const props: SlotProps = { entity: marker(ref(['t3', 't1'], 5)) };
    expect(walk(props, resolver).entity).toEqual([]);
    expect(resolver.resolve(ref(['t3', 't1'], 5)).loading).toBe(true);
    await settle();
    expect((walk(props, resolver).entity as EntityRow[]).map((r) => r.id)).toEqual(['t3', 't1']);
  });

  it('omits a deleted row and re-counts the total from the ref query', async () => {
    const kernel = kernelRows(rows(5));
    kernel.tables.Task = kernel.tables.Task.filter((r) => r.id !== 't2');
    const resolver = createRowSetResolver({ resolve: kernel.resolve });
    const r = ref(['t1', 't2', 't3'], 5);
    resolver.resolve(r);
    await settle();
    const res = resolver.resolve(r);
    expect(res.rows.map((x) => x.id)).toEqual(['t1', 't3']);
    expect(res.total).toBe(4);
  });

  it('omits a row the kernel now hides from the viewer', async () => {
    const kernel = kernelRows(rows(3), new Set(['t2']));
    const resolver = createRowSetResolver({ resolve: kernel.resolve });
    const r = ref(['t1', 't2', 't3'], 3);
    resolver.resolve(r);
    await settle();
    const res = resolver.resolve(r);
    expect(res.rows.map((x) => x.id)).toEqual(['t1', 't3']);
    expect(res.total).toBe(2);
  });

  it('re-resolves after a write to the entity (rows-changed)', async () => {
    const kernel = kernelRows(rows(3));
    const resolver = createRowSetResolver({ resolve: kernel.resolve });
    const r = ref(['t1', 't2'], 3);
    const props: SlotProps = { entity: marker(r) };
    walk(props, resolver);
    await settle();
    expect((walk(props, resolver).entity as EntityRow[]).map((x) => x.title)).toEqual(['T1', 'T2']);
    kernel.tables.Task = kernel.tables.Task.map((x) => (x.id === 't1' ? { ...x, title: 'renamed' } : x));
    let notified = 0;
    resolver.subscribe(() => { notified += 1; });
    resolver.rowsChanged('Task');
    await settle();
    expect(notified).toBeGreaterThan(0);
    expect((walk(props, resolver).entity as EntityRow[]).map((x) => x.title)).toEqual(['renamed', 'T2']);
  });

  it('a write to another entity type leaves the resolution untouched', async () => {
    const resolver = createRowSetResolver({ resolve: kernelRows(rows(2)).resolve });
    const r = ref(['t1'], 2);
    resolver.resolve(r);
    await settle();
    const before = resolver.resolve(r);
    resolver.rowsChanged('Other');
    expect(resolver.resolve(r)).toBe(before);
  });

  it('control: props without a marker keep their identity', () => {
    const resolver = createRowSetResolver({ resolve: kernelRows([]).resolve });
    const props: SlotProps = { entity: [{ id: 'a' }], title: 'x' };
    expect(resolveRenderBindingMarkers(props, 'Board', {}, undefined, 'idle', undefined, resolver)).toBe(props);
  });
});
