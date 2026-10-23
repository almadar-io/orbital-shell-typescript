import { OrbitalEventResponse } from '@almadar/core';
import { LocalFoldKernel } from './client-kernel.js';
import { CircuitStore } from './circuit-store.js';
import { TransitionObserver } from './trait-types.js';
import './awaiting.js';
import './state-book.js';
import '@almadar/core/kernel-wire';

/**
 * The view's side of a dispatch the in-process kernel already ran: report its executed hops to the observer,
 * mirror its states, rows and sticky callsite payloads into the `CircuitStore`, then notify subscribers.
 * One implementation for every response the kernel produces (a dispatch, a mount seed, a posted leg's fold,
 * a tick frame).
 */

declare function mirrorResponse(store: CircuitStore, frameKeyOf: (trait: string) => string | undefined, response: OrbitalEventResponse): void;
declare function traceResponse(observer: TransitionObserver | undefined, response: OrbitalEventResponse): void;
interface LocalFoldOptions {
    store: CircuitStore;
    frameKeyOf(trait: string): string | undefined;
    observer?: TransitionObserver;
}
declare function createLocalFold(opts: LocalFoldOptions): LocalFoldKernel;

export { type LocalFoldOptions, createLocalFold, mirrorResponse, traceResponse };
