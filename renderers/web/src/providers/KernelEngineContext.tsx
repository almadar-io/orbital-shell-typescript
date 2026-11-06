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
import type { FrameScheduler } from '../lib/kernel-frames';
import type { OsHostPort } from '@almadar/shell-runtime/kernel/os-port';
import type { KernelCanvas3DFactory, KernelGpuHost, KernelSceneCanvasFactory } from '@almadar/shell-runtime/kernel/wire';

export interface KernelEngineValue {
  /** Resolves the initialised `@almadar/kernel` module, its language installed (`@almadar/shell-browser/kernel-loader`); shared by every circuit under the provider. */
  loadModule: () => Promise<KernelModule>;
  /** Supplies the frame clock the kernel's ticks run on; absent = `requestAnimationFrame`. */
  scheduleFrame?: FrameScheduler;
  /** The host's `os` port (`createFetchOsHost(fetch)`) every local-store kernel under the provider is opened with; absent, a program's `os` asks are denied. */
  os?: OsHostPort;
  /** The host's GPU answerer (the kernel module's `GpuHost`), made once after the module loads and installed into every circuit kernel under the provider; absent, a `gpu/` ask answers `unsupported`. */
  gpu?: () => KernelGpuHost;
  /** Makes an orbital-canvas 3D view on a page canvas once the module has loaded; absent, a 3D canvas has no renderer. */
  canvas3d?: KernelCanvas3DFactory;
  /** Makes an orbital-canvas scene canvas (2D instruments, diagrams) on a page canvas once the module has loaded. */
  sceneCanvas?: KernelSceneCanvasFactory;
}

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

export interface KernelEngineProviderProps {
  loader: KernelLoader;
  scheduleFrame?: FrameScheduler;
  os?: OsHostPort;
  /** Makes the host's GPU answerer once the module has loaded (`() => new GpuHost()`). */
  gpu?: () => KernelGpuHost;
  /** Makes a 3D view on a page canvas (`(canvas) => Canvas3D.create(canvas)`). */
  canvas3d?: KernelCanvas3DFactory;
  /** Makes a scene canvas on a page canvas (`(canvas) => SceneCanvas.create(canvas)`). */
  sceneCanvas?: KernelSceneCanvasFactory;
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
    let gpuHost: KernelGpuHost | undefined;
    const loadModule = (): Promise<KernelModule> => (module ??= load());
    return {
      loadModule,
      ...(scheduleFrame !== undefined ? { scheduleFrame } : {}),
      ...(os !== undefined ? { os } : {}),
      ...(gpu !== undefined ? { gpu: () => (gpuHost ??= gpu()) } : {}),
      ...(canvas3d !== undefined ? { canvas3d: (canvas: HTMLCanvasElement) => loadModule().then(() => canvas3d(canvas)) } : {}),
      ...(sceneCanvas !== undefined ? { sceneCanvas: (canvas: HTMLCanvasElement) => loadModule().then(() => sceneCanvas(canvas)) } : {}),
    };
  }, [loader, scheduleFrame, os, gpu, canvas3d, sceneCanvas]);
  return <KernelEngineContext.Provider value={value}>{children}</KernelEngineContext.Provider>;
}
