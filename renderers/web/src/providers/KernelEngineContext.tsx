'use client';
/**
 * KernelEngineContext
 *
 * Every circuit runs on the Rust client-role kernel as WebAssembly (`@almadar/kernel`). The host supplies the
 * loader, so `@almadar/ui` imports none of the package; the provider loads the module once and every circuit under
 * it shares that module. A circuit with no provider above it is an error, never a fallback engine.
 *
 * @packageDocumentation
 */
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { installKernelEvaluator } from '@almadar/core';
import { installNativeLanguages } from '@almadar/syntax';
import type { KernelLoader, KernelModule } from '../lib/kernel-wire';
import { kernelEngine, type KernelEngineHost, type KernelEngineValue } from './kernel-engine';

export { kernelEngine, type KernelEngineHost, type KernelEngineValue };

export const KernelEngineContext = createContext<KernelEngineValue | null>(null);

/** The kernel the nearest `KernelEngineProvider` supplies; `null` with none above. */
export function useKernelEngine(): KernelEngineValue | null {
  return useContext(KernelEngineContext);
}

/** A circuit mounted with no `KernelEngineProvider` (nor an `OrbPreview` `kernelLoader`) above it. */
export class KernelLoaderMissingError extends Error {
  constructor() {
    super('No kernel loader: wrap the app in <KernelEngineProvider loader={() => import(\'@almadar/kernel/client\')…}> or pass kernelLoader to OrbPreview');
  }
}

export interface KernelEngineProviderProps extends KernelEngineHost {
  loader: KernelLoader;
  children?: ReactNode;
}

export function KernelEngineProvider({ loader, scheduleFrame, os, gpu, canvas3d, sceneCanvas, children }: KernelEngineProviderProps): React.ReactElement {
  const value = useMemo<KernelEngineValue>(() => {
    let module: Promise<KernelModule> | undefined;
    const load = (): Promise<KernelModule> =>
      loader().then((loaded) => {
        installKernelEvaluator(loaded);
        installNativeLanguages();
        return loaded;
      });
    return kernelEngine(() => (module ??= load()), { scheduleFrame, os, gpu, canvas3d, sceneCanvas });
  }, [loader, scheduleFrame, os, gpu, canvas3d, sceneCanvas]);
  return <KernelEngineContext.Provider value={value}>{children}</KernelEngineContext.Provider>;
}
