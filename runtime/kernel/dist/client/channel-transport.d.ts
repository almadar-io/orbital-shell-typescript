import { OrbitalEventRequest, OrbitalEventResponse, EmittedEvent } from '@almadar/core';
import { PushTarget, EventTransport } from './EventTransport.js';

/**
 * An EventTransport over a message channel, for a program hosted in another browser context (an
 * extension's service worker, a web worker, an iframe). The view half plays events and receives
 * pushes; the host half serves any EventTransport on the channel and pushes to its views. The
 * channel is two functions, so any postMessage-style port fits behind it.
 */

type ChannelMessage = {
    almadarChannel: 'register';
    id: number;
    schemaName: string;
} | {
    almadarChannel: 'registered';
    id: number;
    held: boolean;
} | {
    almadarChannel: 'send';
    id: number;
    orbitalName: string;
    request: OrbitalEventRequest;
} | {
    almadarChannel: 'reply';
    id: number;
    response: OrbitalEventResponse;
} | {
    almadarChannel: 'push';
    emitted: EmittedEvent;
    target: PushTarget;
} | {
    almadarChannel: 'dispatched';
    orbitalName: string;
    request: OrbitalEventRequest;
    response: OrbitalEventResponse;
};
interface TransportChannel {
    post(message: ChannelMessage): void;
    onMessage(listener: (message: ChannelMessage) => void): () => void;
    /** The other end went away for good (a stopped extension worker's port); absent for channels that cannot close. */
    onClose?(listener: () => void): () => void;
}
interface ChannelTransportOptions {
    /** The host on the other end keeps the program's browser-stored entities (see `EventTransport.hostsBrowserStore`). */
    hostsBrowserStore?: boolean;
}
/** The view half: an EventTransport whose program lives on the other end of the channel. */
declare function createChannelTransport(channel: TransportChannel, options?: ChannelTransportOptions): EventTransport;
interface ServedChannel {
    /** Push a host-side event to the view (e.g. one a declared input caused while no view was asking). */
    push(emitted: EmittedEvent, target: PushTarget): void;
    /** Send the view the result of a dispatch the host ran on its own. */
    pushDispatch(orbitalName: string, request: OrbitalEventRequest, response: OrbitalEventResponse): void;
    stop(): void;
}
/** The host half: serve `transport` on `channel` for the program named `schemaName`. */
declare function serveChannel(channel: TransportChannel, transport: EventTransport, options: {
    schemaName: string;
}): ServedChannel;
/**
 * A channel that listens from the moment it is wrapped and keeps what arrives until something
 * subscribes, then hands it over in order: a host that is still starting (an extension worker
 * waking up) serves the channel late without losing the view's first messages.
 */
declare function holdUntilServed(channel: TransportChannel): TransportChannel;

export { type ChannelMessage, type ChannelTransportOptions, type ServedChannel, type TransportChannel, createChannelTransport, holdUntilServed, serveChannel };
