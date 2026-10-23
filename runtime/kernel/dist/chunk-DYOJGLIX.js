import { findExternalInput } from '@almadar/core';

// src/client/declared-input-dispatch.ts
async function dispatchDeclaredInput(schema, orbitalName, request, send) {
  const declared = schema ? findExternalInput(schema, orbitalName, request.targetTrait, request.event) : void 0;
  if (!declared) {
    return {
      success: false,
      transitioned: false,
      states: {},
      emittedEvents: [],
      error: `'${request.event}' is not an external input of ${orbitalName}.${request.targetTrait}`,
      rejections: [{ code: "not-an-external-input", trait: request.targetTrait, event: request.event }]
    };
  }
  return send(orbitalName, {
    event: request.event,
    payload: request.payload ?? {},
    targetTrait: request.targetTrait,
    ...request.user !== void 0 ? { user: request.user } : {},
    ...request.entityId !== void 0 ? { entityId: request.entityId } : {}
  });
}

export { dispatchDeclaredInput };
