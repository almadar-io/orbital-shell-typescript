/**
 * The web host's side of the native `std-mock-seed` program: it opens the program on a kernel of its own (a browser
 * store is seeded before the app's kernel exists) or forks it off the app's kernel (a mock store shares the app's
 * entity and policy metadata), and hands the seeder to the shared seed rules in `@almadar/shell-runtime`.
 *
 * @packageDocumentation
 */
import type { OrbitalSchema, PersistenceAdapter, UserContext } from '@almadar/core';
import { StdMockSeed, declaredSeedConfig, type MockSeedEngine } from './std-mock-seed.js';
import type { MockSeedHost } from './mockStoreSeed.js';
import type { BrowserSeedHost } from './seedBrowserStore.js';
import type { KernelEngine } from '../../kernel/engine.js';
import type { KernelModule, SeedProgramLoader } from '../../lib/kernel-wire.js';
import { nativeMemoryPersistence } from '../evaluation/native-memory.js';
import { openLocalKernel } from '../evaluation/local-store-transport.js';

/** Where a browser store gets the seed program: the kernel and language it runs on and the loader that resolves the program. */
export interface BrowserStoreSeeding {
  kernel: KernelModule;
  language: string;
  loadSeedProgram: SeedProgramLoader;
  /** The app being seeded: its composition of std-mock-seed, if any, sets the declared seeding values. */
  app: OrbitalSchema;
}

/** Run `use` with a browser-store seed host; the seed program opens on first ask and is released after. */
export async function withBrowserSeeder<T>(seeding: BrowserStoreSeeding, use: (host: BrowserSeedHost) => Promise<T>): Promise<T> {
  const program: OrbitalSchema = await seeding.loadSeedProgram();
  let opened: KernelEngine | undefined;
  const engine: MockSeedEngine = {
    evaluate: async (orbital, request, scope) => {
      opened ??= openLocalKernel({
        kernel: seeding.kernel,
        language: seeding.language,
        schema: program,
        persistence: nativeMemoryPersistence(seeding.kernel),
      });
      return opened.evaluate(orbital, request, scope);
    },
  };
  try {
    return await use({ seeder: new StdMockSeed(engine, declaredSeedConfig(program, seeding.app)), nowMs: Date.now() });
  } finally {
    opened?.dispose();
  }
}

/** Run `use` with a mock-store seed host whose seed program is forked off `app`; the fork is released after. */
export async function withForkedSeeder<T>(
  app: KernelEngine,
  appSchema: OrbitalSchema,
  loadSeedProgram: SeedProgramLoader,
  persistence: PersistenceAdapter,
  user: UserContext | undefined,
  use: (host: MockSeedHost) => Promise<T>,
): Promise<T> {
  const program: OrbitalSchema = await loadSeedProgram();
  const fork = app.forkProgram(program);
  try {
    return await use({ seeder: new StdMockSeed(fork, declaredSeedConfig(program, appSchema), user), persistence, nowMs: Date.now() });
  } finally {
    fork.dispose();
  }
}
