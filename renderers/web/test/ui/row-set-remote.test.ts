/**
 * A reference whose rows live on a server resolves through the transport's resolve route (the server applies the
 * viewer's `@read`); a browser-stored entity still resolves against the browser store. Rows-changed re-resolves.
 */
import { describe, it, expect, vi } from 'vitest';
import { runRowQuery, type EntityRow, type PersistenceAdapter, type RowQuery, type RowQueryPage, type RowSetRef } from '@almadar/core';
import { createCircuitRowSetResolver } from '../../src/lib/store-row-set-resolver';

const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const ref = (entityType: string, ids: string[]): RowSetRef => ({ entityType, ids, total: ids.length, query: {} });

/** A server whose `@read` hides u2's rows from the requesting viewer. */
const serverRows = (rows: EntityRow[]) =>
  vi.fn(async (r: RowSetRef): Promise<RowQueryPage> => {
    const visible = rows.filter((row) => row.owner !== 'u2');
    const byId = new Map(visible.map((row) => [String(row.id), row]));
    const resolved = r.ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as EntityRow] : []));
    return { rows: resolved, total: visible.length };
  });

describe('server-hosted references', () => {
  it('resolves through the transport and omits a row the server hides from the viewer', async () => {
    const rows: EntityRow[] = [{ id: 't1', owner: 'u1' }, { id: 't2', owner: 'u2' }, { id: 't3', owner: 'u1' }];
    const remote = serverRows(rows);
    const resolver = createCircuitRowSetResolver({ remote });
    const r = ref('Task', ['t1', 't2', 't3']);
    expect(resolver?.resolve(r).loading).toBe(true);
    await settle();
    const done = resolver?.resolve(r);
    expect(done?.rows.map((x) => x.id)).toEqual(['t1', 't3']);
    expect(done?.total).toBe(2);
    expect(done?.loading).toBe(false);
  });

  it('a rows-changed signal for the entity asks the server again; another entity does not', async () => {
    const rows: EntityRow[] = [{ id: 't1', owner: 'u1' }];
    const remote = serverRows(rows);
    const resolver = createCircuitRowSetResolver({ remote });
    const r = ref('Task', ['t1']);
    resolver?.resolve(r);
    await settle();
    expect(remote).toHaveBeenCalledTimes(1);
    resolver?.rowsChanged('User');
    await settle();
    expect(remote).toHaveBeenCalledTimes(1);
    rows.push({ id: 't9', owner: 'u1' });
    resolver?.rowsChanged('Task');
    expect(resolver?.resolve(r).loading).toBe(true);
    await settle();
    expect(remote).toHaveBeenCalledTimes(2);
    expect(resolver?.resolve(r).loading).toBe(false);
  });

  it('control: no transport route and no browser store gives no resolver, so markers stay raw', () => {
    expect(createCircuitRowSetResolver({})).toBeUndefined();
  });
});

describe('one store location, one path', () => {
  it('a browser-stored entity resolves against the browser store, any other against the server', async () => {
    const queryPage = vi.fn(async (entityType: string, query: RowQuery) => runRowQuery([{ id: 'n1' }, { id: 'n2' }], query));
    const store: Pick<PersistenceAdapter, 'queryPage'> = { queryPage };
    const remote = serverRows([{ id: 't1', owner: 'u1' }]);
    const resolver = createCircuitRowSetResolver({ browser: { store: store as PersistenceAdapter, entityTypes: new Set(['Note']) }, remote });
    resolver?.resolve(ref('Note', ['n2']));
    resolver?.resolve(ref('Task', ['t1']));
    await settle();
    expect(queryPage).toHaveBeenCalled();
    expect(remote).toHaveBeenCalledTimes(1);
    expect(remote.mock.calls[0]?.[0].entityType).toBe('Task');
    expect(resolver?.resolve(ref('Note', ['n2'])).rows.map((x) => x.id)).toEqual(['n2']);
  });
});
