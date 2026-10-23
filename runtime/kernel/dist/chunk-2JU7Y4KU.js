import { findInbound, unknownHook, credentialUnset, inboundPayload, inboundAnswerOf, dispatchFailed } from '@almadar/core';

// src/client/inbound-dispatch.ts
async function dispatchInbound(schema, name, delivery, send, credential) {
  const route = schema ? findInbound(schema, name) : void 0;
  if (route === void 0) return unknownHook(name);
  try {
    const held = route.verifies !== void 0 ? await credential(route.verifies.credential) : void 0;
    if (route.verifies !== void 0 && (held === void 0 || held === null || held === "")) return credentialUnset(route.verifies.credential);
    const response = await send(route.orbital, {
      event: route.event,
      payload: inboundPayload(route, delivery, held),
      targetTrait: route.trait
    });
    return inboundAnswerOf(route, response.emittedEvents, response.error);
  } catch (error) {
    return dispatchFailed(error instanceof Error ? error.message : String(error));
  }
}

export { dispatchInbound };
