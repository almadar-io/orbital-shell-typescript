import { PersistenceAdapter, UserContext, Entity, OrbitalSchema } from '@almadar/core';
import { StdMockSeed, SeedOwnerJournal } from './std-mock-seed.js';
import '../../kernel/engine.js';
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
 * The one mock-store seed both JS hosts of a mock program run. The native `std-mock-seed` program decides the rows,
 * the owner columns and who owns them, and writes them through the kernel; this module binds the declared collections
 * and hands the program the app's resolved schema.
 *
 * @packageDocumentation
 */

interface MockSeedHost {
    /** The kernel running the std seed program. */
    seeder: StdMockSeed;
    persistence: PersistenceAdapter;
    /** The clock mock dates and seed stamps resolve against, in epoch milliseconds. */
    nowMs: number;
}
interface MockSeedViewer {
    /** Whether the host named the viewer; when it did not, the viewer is the declared `defaultPersona` (anonymous when none). */
    namedByHost: boolean;
    /** The viewer at evaluation time. */
    current: () => UserContext | undefined;
    /** Whether the `[identity]` entity (the persona roster) seeds now; a host that seeds it elsewhere passes false. */
    seedIdentity: boolean;
}
interface MockSeeded {
    viewer: UserContext | undefined;
    /** The owner cells the seed stamped, kept for a later persona restamp. */
    journal: SeedOwnerJournal;
}
/** Tells the store each server-persisted entity's declared `[persistent: tbl]` collection (EXEC-STORE-1). */
declare function bindDeclaredCollections(store: PersistenceAdapter, entities: readonly Entity[]): void;
/**
 * A whole program's mock store, seeded for the viewer. A named viewer owns the rows from the first seed; otherwise
 * the roster seeds unstamped and the viewer is the identity row the declared `defaultPersona` names, whose tracked
 * owner cells restamp to it; with no `defaultPersona` the viewer is anonymous and nothing restamps.
 */
declare function seedMockStore(host: MockSeedHost, schema: OrbitalSchema, viewer: MockSeedViewer): Promise<MockSeeded>;
/** Re-point the seeded owner cells at `user` after a persona switch; the rows are the store's current ones. */
declare function restampMockOwner(host: MockSeedHost, schema: OrbitalSchema, journal: SeedOwnerJournal, user: UserContext): Promise<SeedOwnerJournal>;

export { type MockSeedHost, type MockSeedViewer, type MockSeeded, bindDeclaredCollections, restampMockOwner, seedMockStore };
