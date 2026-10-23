/**
 * The one RowSetResolver of a circuit: a reference is answered where its entity's rows live, always by a kernel that
 * applies the viewer's `@read` itself. A browser-stored entity resolves on a kernel opened over the browser store;
 * any other entity on the server that holds it (`EventTransport.resolveRows`). With neither, markers stay raw.
 *
 * @packageDocumentation
 */
import type { RowQueryPage, RowSetRef } from '@almadar/core';
import { createRowSetResolver, type RowSetResolver } from './row-set-resolver';

export interface CircuitRowSetSources {
  browser?: {
    resolve: (ref: RowSetRef) => Promise<RowQueryPage>;
    /** The entity types the browser store holds. */
    entityTypes: ReadonlySet<string>;
  };
  /** The server transport's resolve route. */
  remote?: (ref: RowSetRef) => Promise<RowQueryPage>;
}

export function createCircuitRowSetResolver({ browser, remote }: CircuitRowSetSources): RowSetResolver | undefined {
  if (browser === undefined && remote === undefined) return undefined;
  return createRowSetResolver({
    resolve: (ref) => {
      if (browser !== undefined && browser.entityTypes.has(ref.entityType)) return browser.resolve(ref);
      if (remote !== undefined) return remote(ref);
      return Promise.reject(new Error(`${ref.entityType}: no store to resolve a row set against`));
    },
  });
}
