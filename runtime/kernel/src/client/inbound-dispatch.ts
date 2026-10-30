/**
 * The dispatcher for inbound deliveries (EXEC-INBOUND-1). A host carries `{name, headers,
 * rawBody}` from `/api/hooks/<name>`; the kernel decides whether the name is served, what payload the
 * handler event is delivered with and what answer the handler's emit of its `answers` event is; this
 * delivers the event through the host's own dispatch and writes what the kernel said.
 */
import type { InboundAnswer, InboundDelivery, EventRequest, EventResponse } from '@almadar/core';
import type { KernelEngine } from '../kernel/engine.js';

export type InboundContract = Pick<KernelEngine, 'findInbound' | 'inboundPayload' | 'inboundAnswer' | 'credentialUnset' | 'dispatchFailed'>;

export async function dispatchInbound(
  contract: InboundContract,
  name: string,
  delivery: InboundDelivery,
  send: (orbitalName: string, request: EventRequest) => Promise<EventResponse>,
  credential: (name: string) => Promise<string | null | undefined>,
): Promise<InboundAnswer> {
  const found = contract.findInbound(name);
  if (!('route' in found)) return found.answer;
  const { route } = found;
  try {
    const held = route.verifies !== undefined ? await credential(route.verifies.credential) : undefined;
    if (route.verifies !== undefined && (held === undefined || held === null || held === '')) return contract.credentialUnset(route.verifies.credential);
    const response = await send(route.orbital, {
      event: route.event,
      payload: contract.inboundPayload(route, delivery, held),
      targetTrait: route.trait,
    });
    return contract.inboundAnswer(route, response.emittedEvents, response.error);
  } catch (error) {
    return contract.dispatchFailed(error instanceof Error ? error.message : String(error));
  }
}
