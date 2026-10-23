/**
 * RowSetResolver: the one paint-time resolve entry for `RowSetMarker` leaves (Speed Design 5.4/5.5).
 * A ref is resolved by the kernel that holds its rows (`KernelEngine.resolveRows` over the browser store, or the
 * server's `EventTransport.resolveRows`), which re-checks the viewer's `@read`; `total` is a true re-count of the ref's query. A missing or now-hidden row is omitted. `rowsChanged(entityType)` (EXEC-RENDER-3) re-resolves every ref
 * of that type. Answers are asynchronous, so `resolve` is a synchronous read of the cache and kicks the fetch.
 *
 * @packageDocumentation
 */
import { createLogger } from '@almadar/logger';
import type { EntityRow, RowQueryPage, RowSetRef } from '@almadar/core';

const log = createLogger('almadar:ui:row-set-resolver');

export interface RowSetResolution {
  rows: EntityRow[];
  total: number;
  /** No answer yet for the current data (first resolve, or a refresh in flight). */
  loading: boolean;
}

/** Where a reference is answered: a kernel that holds the rows and applies `@read` itself. */
export interface RowSetResolverOptions {
  resolve: (ref: RowSetRef) => Promise<RowQueryPage>;
}

export interface RowSetResolver {
  resolve(ref: RowSetRef): RowSetResolution;
  /** A write to `entityType` happened: re-resolve every held ref of that type. */
  rowsChanged(entityType: string): void;
  subscribe(listener: () => void): () => void;
  /** Bumps whenever any resolution changes; render caches key on it. */
  epoch(): number;
}

interface Entry {
  ref: RowSetRef;
  resolution: RowSetResolution;
  generation: number;
}

export function createRowSetResolver(opts: RowSetResolverOptions): RowSetResolver {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let epoch = 0;

  const answerOf = (ref: RowSetRef): Promise<RowQueryPage> => opts.resolve(ref);

  const keyOf = (ref: RowSetRef): string => JSON.stringify([ref.entityType, ref.ids, ref.query]);

  const fetchEntry = (key: string, entry: Entry): void => {
    const generation = ++entry.generation;
    const { ref } = entry;
    const answer = answerOf(ref);
    answer.then(
      (page) => {
        if (entry.generation !== generation) return;
        entry.resolution = { rows: page.rows, total: page.total, loading: false };
        epoch += 1;
        for (const l of [...listeners]) l();
      },
      (error: Error) => {
        log.error('row set resolve failed', { entityType: ref.entityType, error: error.message });
      },
    );
    entries.set(key, entry);
  };

  return {
    resolve(ref) {
      const key = keyOf(ref);
      const hit = entries.get(key);
      if (hit !== undefined) return hit.resolution;
      const entry: Entry = { ref, resolution: { rows: [], total: ref.total, loading: true }, generation: 0 };
      fetchEntry(key, entry);
      return entry.resolution;
    },
    rowsChanged(entityType) {
      for (const [key, entry] of entries) {
        if (entry.ref.entityType !== entityType) continue;
        entry.resolution = { ...entry.resolution, loading: true };
        fetchEntry(key, entry);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    epoch: () => epoch,
  };
}
