/**
 * Opens the browser store for a program's `[persistent: x, browser]`
 * entities, one database per app and viewer locale. `none` when the program declares none; the kernel's native memory store holds and queries the rows, the database persists them; a failure to open is a state
 * the host shows, never a silent fallback to another store.
 */
import { useEffect, useMemo, useState } from 'react';
import type { OrbitalDefinition } from '@almadar/core';
import { orbitalInlineEntities, storesRowsInBrowser } from '@almadar/core';
import { browserStoreName, openBrowserStore } from '../../runtime';
import { persistedMemory } from '../../runtime/evaluation/persisted-memory';
import { KernelLoaderMissingError, useKernelEngine } from '../../providers/KernelEngineContext';
import type { IndexedDbPersistence } from '@almadar/shell-browser/storage';
import type { PersistenceAdapter } from '@almadar/core';

export type BrowserStoreState =
  | { status: 'none' }
  | { status: 'opening' }
  | { status: 'ready'; store: PersistenceAdapter }
  | { status: 'failed'; error: Error };

export function useBrowserStore(appName: string, orbitals: readonly OrbitalDefinition[], locale?: string): BrowserStoreState {
  const entities = useMemo(() => orbitals.flatMap(orbitalInlineEntities).filter(storesRowsInBrowser), [orbitals]);
  const engine = useKernelEngine();
  const [state, setState] = useState<BrowserStoreState>(() => (entities.length === 0 ? { status: 'none' } : { status: 'opening' }));

  useEffect(() => {
    if (entities.length === 0) {
      setState({ status: 'none' });
      return;
    }
    let cancelled = false;
    let opened: IndexedDbPersistence | undefined;
    setState({ status: 'opening' });
    const open = async (): Promise<void> => {
      try {
        if (engine === null) throw new KernelLoaderMissingError();
        const database = await openBrowserStore(browserStoreName(appName, locale), orbitals);
        if (database === null) return;
        opened = database;
        const store = await persistedMemory(await engine.loadModule(), database, entities, locale);
        if (!cancelled) setState({ status: 'ready', store });
      } catch (err: unknown) {
        if (!cancelled) setState({ status: 'failed', error: err instanceof Error ? err : new Error(String(err)) });
      }
    };
    void open();
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [appName, locale, entities, orbitals, engine]);

  return state;
}
