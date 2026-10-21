/**
 * The one RowSetResolver of a circuit: a reference is answered where its entity's rows live. A browser-stored entity
 * resolves against the browser store (the viewer's `@read` applied here); any other entity resolves on the server
 * that holds it (`EventTransport.resolveRows`, `@read` applied there). A store with no `queryPage` and a transport
 * with no resolve route cannot answer a reference, so they get none and markers stay raw.
 *
 * @packageDocumentation
 */
import type { PersistenceAdapter, RowPredicate, RowQueryPage, RowSetRef } from '@almadar/core';
import { resolveRowSetFromStore } from '../runtime';
import { createRowSetResolver, type RowSetResolver } from './row-set-resolver';

export interface CircuitRowSetSources {
  browser?: {
    store: PersistenceAdapter;
    /** The entity types the browser store holds. */
    entityTypes: ReadonlySet<string>;
    policy?: (entityType: string) => RowPredicate | undefined;
  };
  /** The server transport's resolve route. */
  remote?: (ref: RowSetRef) => Promise<RowQueryPage>;
}

export function createCircuitRowSetResolver({ browser, remote }: CircuitRowSetSources): RowSetResolver | undefined {
  const queryPage = browser?.store.queryPage?.bind(browser.store);
  if (queryPage === undefined && remote === undefined) return undefined;
  return createRowSetResolver({
    resolve: (ref) => {
      if (browser !== undefined && queryPage !== undefined && browser.entityTypes.has(ref.entityType)) {
        return resolveRowSetFromStore({ queryPage }, ref, browser.policy?.(ref.entityType));
      }
      if (remote !== undefined) return remote(ref);
      return Promise.reject(new Error(`${ref.entityType}: no store to resolve a row set against`));
    },
  });
}
