/**
 * Row sets of browser-stored entities resolved on a kernel opened over the browser store: the kernel applies the
 * viewer's `@read` and asks this host only for rows. The kernel opens on the first resolve and is released by `dispose`.
 *
 * @packageDocumentation
 */
import type { OrbitalSchema, PersistenceAdapter, RowQueryPage, RowSetRef, UserContext } from '@almadar/core';
import { localStorePersistence, nativeMemoryPersistence, openLocalKernel, resolveLocalRows } from '../runtime';
import type { KernelEngine } from '../kernel/engine.js';
import { LanguageLoaderMissingError, type KernelEngineValue } from '../providers/KernelEngineContext';

export interface BrowserRowSets {
  resolve(reference: RowSetRef): Promise<RowQueryPage>;
  dispose(): void;
}

export function browserRowSets(
  engine: KernelEngineValue,
  schema: OrbitalSchema,
  store: PersistenceAdapter,
  user: UserContext | undefined,
): BrowserRowSets {
  let opened: Promise<KernelEngine> | undefined;
  let disposed = false;
  const open = (): Promise<KernelEngine> => {
    opened ??= Promise.all([
      engine.loadModule(),
      engine.loadLanguage !== undefined ? engine.loadLanguage() : Promise.reject(new LanguageLoaderMissingError()),
    ]).then(([kernel, bundle]) => {
      const kernelEngine = openLocalKernel({ kernel, language: bundle, schema, persistence: localStorePersistence(schema, store, nativeMemoryPersistence(kernel)) });
      if (disposed) kernelEngine.dispose();
      return kernelEngine;
    });
    return opened;
  };
  return {
    resolve: (reference) => open().then((kernelEngine) => resolveLocalRows(kernelEngine, schema, user, reference)),
    dispose() {
      disposed = true;
      void opened?.then((kernelEngine) => kernelEngine.dispose(), () => undefined);
    },
  };
}
