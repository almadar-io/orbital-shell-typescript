import { EventTransport } from '../../client/EventTransport.js';
import { TraitIndex } from '@almadar/core';

interface ResidenceTransportOptions {
    /** In-process transport over the browser store. */
    local: EventTransport;
    /** The server; absent on a static host. */
    remote?: EventTransport;
    /** The program's entities, for where a row-set reference's rows live. */
    traitIndex: TraitIndex;
}
declare function createResidenceTransport(options: ResidenceTransportOptions): EventTransport;

export { type ResidenceTransportOptions, createResidenceTransport };
