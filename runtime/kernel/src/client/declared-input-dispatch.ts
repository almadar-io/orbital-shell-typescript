/**
 * The dispatcher for declared external inputs. The server runtime and the in-process host (a
 * browser extension's worker) both route outside-client inputs through it: the kernel says whether the
 * input is declared, an undeclared one is refused identically everywhere and a declared one is an ordinary
 * event addressed to its trait.
 */
import type { ExternalInputRequest, EventRequest, EventResponse } from '@almadar/core';
import type { KernelEngine } from '../kernel/engine.js';

export async function dispatchDeclaredInput(
  contract: Pick<KernelEngine, 'findExternalInput'>,
  orbitalName: string,
  request: ExternalInputRequest,
  send: (orbitalName: string, request: EventRequest) => Promise<EventResponse>,
): Promise<EventResponse> {
  const declared = contract.findExternalInput(orbitalName, request.targetTrait, request.event);
  if (!declared) {
    return {
      success: false,
      transitioned: false,
      states: {},
      emittedEvents: [],
      error: `'${request.event}' is not an external input of ${orbitalName}.${request.targetTrait}`,
      rejections: [{ code: 'not-an-external-input', trait: request.targetTrait, event: request.event }],
    };
  }
  return send(orbitalName, {
    event: request.event,
    payload: request.payload ?? {},
    targetTrait: request.targetTrait,
    ...(request.user !== undefined ? { user: request.user } : {}),
    ...(request.entityId !== undefined ? { entityId: request.entityId } : {}),
  });
}
