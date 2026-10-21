'use client';
/**
 * RowSetResolverContext: supplies the one `RowSetResolver` (lib/row-set-resolver) to the slot renderer, which
 * resolves `RowSetMarker` leaves at paint time. The host store and the kernel adapter's rows-changed signal
 * (`resolver.rowsChanged(entityType)`) are the provider's inputs. Absent provider = markers stay raw.
 *
 * @packageDocumentation
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { RowSetResolver } from '../lib/row-set-resolver';

const RowSetResolverContext = createContext<RowSetResolver | undefined>(undefined);

export function RowSetResolverProvider({ resolver, children }: { resolver: RowSetResolver; children?: ReactNode }): React.ReactElement {
  return <RowSetResolverContext.Provider value={resolver}>{children}</RowSetResolverContext.Provider>;
}

/** The resolver alone, without subscribing to its epoch: for writers (the repaint signal), not painters. */
export function useRowSetResolverHandle(): RowSetResolver | undefined {
  return useContext(RowSetResolverContext);
}

/** The resolver (or undefined) and its epoch; re-renders the caller when any resolution changes. */
export function useRowSetResolver(): { resolver: RowSetResolver | undefined; epoch: number } {
  const resolver = useContext(RowSetResolverContext);
  const epoch = useSyncExternalStore(
    (listener) => (resolver === undefined ? () => undefined : resolver.subscribe(listener)),
    () => resolver?.epoch() ?? 0,
  );
  return { resolver, epoch };
}
