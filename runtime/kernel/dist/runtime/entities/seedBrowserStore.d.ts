import { PersistenceAdapter, OrbitalEntity } from '@almadar/core';
import { MockSeedRun, StdMockSeed } from './std-mock-seed.js';
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
 * The one seed rule for browser-stored entities (`[persistent: x, local]`): an EMPTY store gets the rows the native
 * `std-mock-seed` program selects for the viewer's locale (the entity's written-out rows, or generated rows when it
 * declares `mock`), written by that program through the kernel. Rows the user already has are never overwritten.
 */

interface BrowserSeedHost extends Pick<MockSeedRun, 'nowMs'> {
    seeder: StdMockSeed;
}
declare function seedBrowserStore(store: PersistenceAdapter, entities: readonly OrbitalEntity[], locale: string | undefined, host: BrowserSeedHost): Promise<void>;

export { type BrowserSeedHost, seedBrowserStore };
