import { ServiceParams, BusEventSource, EventPayload } from '@almadar/core';
import { ServiceCallContext } from './service-provider.js';

/**
 * The runtime's own `call-service` answerer when the host injects none: the services a host plugged in with
 * `registerServiceProvider`. A call to a service nobody plugged in fails by name, so the trait's declared failure event fires.
 */

/**
 * Where a running `call-service`'s live messages go: the call site's
 * `emit.onMessage` event, stamped as the calling trait. Absent when the call
 * site declares no `onMessage`.
 */
interface ServiceMessageRoute {
    event: string;
    source?: BusEventSource;
}
/** Call an external service. `context` carries the caller's identity (the same viewer entity ACL enforces against) so role-gated services can enforce server-side; hosts forward it to the integration factory. */
type CallServiceHandler = (service: string, action: string, params?: ServiceParams, context?: ServiceCallContext, message?: ServiceMessageRoute) => Promise<EventPayload | null>;
declare function defaultCallService(service: string, action: string, params: ServiceParams | undefined, context?: ServiceCallContext): Promise<EventPayload | null>;

export { type CallServiceHandler, type ServiceMessageRoute, defaultCallService };
