import { UserContext, OrbitalSchema, EntityRow, PersistenceAdapter } from '@almadar/core';
import { KernelEngine } from '../../kernel/engine.js';
import '../../kernel/host.js';
import '../../effects/in-flight-calls.js';
import '../../service/service-provider.js';
import '../../kernel/program-effects.js';
import '../../kernel/http.js';
import '../../kernel/beacon.js';
import '../../credentials/store.js';
import '../../kernel/decode.js';
import '@almadar/core/kernel-wire';
import '../../kernel/os-port.js';
import '../../kernel/wire.js';

/**
 * The host side of the native `std-mock-seed` program. Sampling, owner provenance and persona restamp are decided by
 * that program on the kernel (`DATASET_INPUT`, `RESTAMP_INPUT`), which also writes the rows and owner changes through
 * the kernel's `persist batch`; this module only forwards its inputs and reads its typed answers.
 *
 * @packageDocumentation
 */

/** The kernel running the std seed program (`app.forkProgram(seedProgram)`); only dispatch is used. */
type MockSeedEngine = Pick<KernelEngine, 'evaluate'>;
interface SeedOwnerCell {
    store: string;
    id: string;
    column: string;
}
interface SeedOwnerJournal {
    viewerId: string;
    stamped: SeedOwnerCell[];
    deferred: SeedOwnerCell[];
}
interface SeedOwnerChange extends SeedOwnerCell {
    kind: 'set' | 'rekey';
    ownerId: string;
}
interface SeededDataset {
    /** Rows by declared collection. */
    stores: Record<string, EntityRow[]>;
    journal: SeedOwnerJournal;
}
interface SeedRestamp {
    journal: SeedOwnerJournal;
    changes: SeedOwnerChange[];
}
/** The seeding values a program declares: the std-mock-seed config knobs, as the app's composition sets them, else the atom's defaults. */
interface SeedConfig {
    count: number;
    seed: number;
    /** The identity row id the viewer is when the host names none; empty means anonymous. */
    defaultPersona: string;
    restampOnPersona: boolean;
}
interface MockSeedRun {
    /** The clock relative mock dates and seed stamps resolve against, in epoch milliseconds. */
    nowMs: number;
    /** The viewer the dataset's owner columns are stamped for; absent, the rows seed unstamped. */
    viewerId?: string;
    locale?: string;
}
declare class StdMockSeed {
    private readonly engine;
    readonly config: SeedConfig;
    private readonly user?;
    constructor(engine: MockSeedEngine, config: SeedConfig, user?: UserContext | undefined);
    private ask;
    /** Sample the program's dataset (`DATASET_INPUT`). */
    dataset(program: OrbitalSchema, run: MockSeedRun): Promise<SeededDataset>;
    /**
     * Re-point the dataset's tracked owner cells at `viewer` (`RESTAMP_INPUT`); `stores` are the current authoritative rows.
     * `firstOwner` marks the stamp right after seeding; a persona switch restamps only when the program's
     * `restampOnPersona` config says so, otherwise it answers no changes.
     */
    restamp(program: OrbitalSchema, stores: Record<string, EntityRow[]>, journal: SeedOwnerJournal, viewer: UserContext, firstOwner: boolean): Promise<SeedRestamp>;
}
/**
 * The seeding values as `.lolo` declares them: the std-mock-seed program's own config defaults, overlaid by the
 * config an app's composition of it sets (an orbital that `uses` std-mock-seed and references its MockSeed trait).
 */
declare function declaredSeedConfig(seedProgram: OrbitalSchema, app?: OrbitalSchema): SeedConfig;
/** The current rows of every collection the program declares, as the restamp takes them. */
declare function readSeededStores(persistence: PersistenceAdapter, program: OrbitalSchema): Promise<Record<string, EntityRow[]>>;

export { type MockSeedEngine, type MockSeedRun, type SeedConfig, type SeedOwnerCell, type SeedOwnerChange, type SeedOwnerJournal, type SeedRestamp, type SeededDataset, StdMockSeed, declaredSeedConfig, readSeededStores };
