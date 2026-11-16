/**
 * The kernel engine a `KernelEngineProvider` supplies: what its circuits run on, and how a guest's view gets an
 * instance of its own. Kept apart from the React context so a module that only builds engines imports no provider.
 *
 * @packageDocumentation
 */
import type { KernelModule } from '../lib/kernel-wire';
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
  /** The same engine on a new instance of the kernel module, its own memory freed once nothing references it: what a guest's view runs on (G-ORBITAL-WASM-009). The evaluator every render reads stays on this engine's instance. */
  isolated: () => KernelEngineValue;
  /** Makes an orbital-canvas 3D view on a page canvas once the module has loaded; absent, a 3D canvas has no renderer. */
  canvas3d?: KernelCanvas3DFactory;
  /** Makes an orbital-canvas scene canvas (2D instruments, diagrams) on a page canvas once the module has loaded. */
  sceneCanvas?: KernelSceneCanvasFactory;
}

/** What a host gives an engine beside its loader. */
export interface KernelEngineHost {
  scheduleFrame?: FrameScheduler;
  os?: OsHostPort;
  /** Makes the GPU answerer from the loaded module (`(module) => new module.GpuHost()`): a kernel installs only one of its own instance. */
  gpu?: (module: KernelModule) => KernelGpuHost;
  /** Makes a 3D view on a page canvas (`(canvas) => Canvas3D.create(canvas)`). */
  canvas3d?: KernelCanvas3DFactory;
  /** Makes a scene canvas on a page canvas (`(canvas) => SceneCanvas.create(canvas)`). */
  sceneCanvas?: KernelSceneCanvasFactory;
}

/** The engine whose circuits run on the module `loadModule` resolves; `isolated()` is the same engine on a new instance of it. */
export function kernelEngine(loadModule: () => Promise<KernelModule>, host: KernelEngineHost = {}): KernelEngineValue {
  const { scheduleFrame, os, gpu, canvas3d, sceneCanvas } = host;
  let loaded: KernelModule | undefined;
  let gpuHost: KernelGpuHost | undefined;
  const ready = (): Promise<KernelModule> => loadModule().then((module) => (loaded = module));
  const loadedModule = (): KernelModule => {
    if (loaded === undefined) throw new Error("the GPU answerer is made once the kernel module has loaded");
    return loaded;
  };
  return {
    loadModule: ready,
    ...(scheduleFrame !== undefined ? { scheduleFrame } : {}),
    ...(os !== undefined ? { os } : {}),
    ...(gpu !== undefined ? { gpu: () => (gpuHost ??= gpu(loadedModule())) } : {}),
    ...(canvas3d !== undefined ? { canvas3d: (canvas: HTMLCanvasElement) => ready().then(() => canvas3d(canvas)) } : {}),
    ...(sceneCanvas !== undefined ? { sceneCanvas: (canvas: HTMLCanvasElement) => ready().then(() => sceneCanvas(canvas)) } : {}),
    isolated: () => {
      let own: Promise<KernelModule> | undefined;
      return kernelEngine(() => (own ??= ready().then((module) => module.isolate())), host);
    },
  };
}
