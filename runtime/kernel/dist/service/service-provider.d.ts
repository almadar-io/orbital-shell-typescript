import { ServiceHostPorts, ServiceParams, EventPayload } from '@almadar/core';

/**
 * Caller identity forwarded with a call-service dispatch (I-25) — the id and
 * roster role of the SAME normalized viewer entity ACL enforces against.
 * Absent when no viewer is bound (ticks, anonymous); role-gated services
 * fail closed on absence.
 */
interface ServiceCallContext {
    principal?: string;
    role?: string;
    /** The running app, lent for this call as the caller (`page watch`). */
    host?: ServiceHostPorts;
    /** Aborted when `cancel-call` cancels this call; a provider stops its work on it. */
    signal?: AbortSignal;
    /** No request awaits this call (a follow-on step's call): the host holds no request's event queue around it. */
    outsideRequest?: true;
}
/** Why a service call failed, for a provider to name: bad params, no host installed, no signed-in caller, an action it does not have. */
type ServiceCallErrorCode = 'VALIDATION_ERROR' | 'NOT_CONFIGURED' | 'AUTH_ERROR' | 'UNKNOWN_ACTION';
declare class ServiceCallError extends Error {
    readonly code: ServiceCallErrorCode;
    constructor(message: string, code: ServiceCallErrorCode);
}
/** A host's answerer for the `call-service` calls of one named service: resolves the payload, throws to fail the call. */
type ServiceProvider = (action: string, params: ServiceParams, context?: ServiceCallContext) => Promise<EventPayload | null>;
/** Plug a service's answerer into this process's `call-service`; a later registration of the same name replaces it. */
declare function registerServiceProvider(service: string, provider: ServiceProvider): void;
/** Testing/reset hook. */
declare function unregisterServiceProvider(service: string): void;
/** The names of the services a host has plugged in. */
declare function registeredServices(): string[];
/** Calls `service.action` through the registered provider; a service no host plugged in is a named failure. */
declare function callRegisteredService(service: string, action: string, params: ServiceParams | undefined, context?: ServiceCallContext): Promise<EventPayload | null>;

export { type ServiceCallContext, ServiceCallError, type ServiceCallErrorCode, type ServiceProvider, callRegisteredService, registerServiceProvider, registeredServices, unregisterServiceProvider };
