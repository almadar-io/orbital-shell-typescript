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
import type { KernelLoader, KernelModule, LanguageLoader, SeedProgramLoader } from '../lib/kernel-wire';
import type { FrameScheduler } from '../lib/kernel-frames';

export interface KernelEngineValue {
  /** Resolves the initialised `@almadar/kernel` module; shared by every circuit under the provider. */
  loadModule: () => Promise<KernelModule>;
  /** Resolves the language bundle a local-store kernel is opened with; fetched once, on the first such kernel. */
  loadLanguage?: LanguageLoader;
  /** Resolves the std mock-seed program a mock or browser store is seeded by; fetched once, on the first such seed. */
  loadSeedProgram?: SeedProgramLoader;
  /** Supplies the frame clock the kernel's ticks run on; absent = `requestAnimationFrame`. */
  scheduleFrame?: FrameScheduler;
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

/** A program whose rows live in the browser opened a kernel there, and no `languageLoader` supplies its language. */
export class LanguageLoaderMissingError extends Error {
  constructor() {
    super('No language loader: a program storing rows in the browser opens a kernel there, which needs the language bundle; pass languageLoader to <KernelEngineProvider> (or OrbPreview)');
  }
}

/** A program seeding a mock or browser store opened a seeder, and no `seedProgramLoader` supplies the std seed program. */
export class SeedProgramLoaderMissingError extends Error {
  constructor() {
    super('No seed program loader: seeding a mock or browser store runs the std mock-seed program; pass seedProgramLoader to <KernelEngineProvider> (or OrbPreview)');
  }
}

export interface KernelEngineProviderProps {
  loader: KernelLoader;
  languageLoader?: LanguageLoader;
  seedProgramLoader?: SeedProgramLoader;
  scheduleFrame?: FrameScheduler;
  children?: ReactNode;
}

export function KernelEngineProvider({ loader, languageLoader, seedProgramLoader, scheduleFrame, children }: KernelEngineProviderProps): React.ReactElement {
  const value = useMemo<KernelEngineValue>(() => {
    let module: Promise<KernelModule> | undefined;
    const load = (): Promise<KernelModule> =>
      loader().then((loaded) => {
        installKernelEvaluator(loaded);
        return loaded;
      });
    let language: Promise<string> | undefined;
    let seedProgram: ReturnType<SeedProgramLoader> | undefined;
    return {
      loadModule: () => (module ??= load()),
      ...(languageLoader !== undefined ? { loadLanguage: () => (language ??= languageLoader()) } : {}),
      ...(seedProgramLoader !== undefined ? { loadSeedProgram: () => (seedProgram ??= seedProgramLoader()) } : {}),
      ...(scheduleFrame !== undefined ? { scheduleFrame } : {}),
    };
  }, [loader, languageLoader, seedProgramLoader, scheduleFrame]);
  return <KernelEngineContext.Provider value={value}>{children}</KernelEngineContext.Provider>;
}
