// src/client/local-fold.ts
function mirrorResponse(store, frameKeyOf, response) {
  for (const [trait, state] of Object.entries(response.states)) {
    if (store.states.getState(trait)?.currentState !== state) store.states.seedState(trait, state);
  }
  for (const [trait, row] of Object.entries(response.entityByTrait ?? {})) {
    const frameKey = frameKeyOf(trait);
    if (frameKey === void 0) continue;
    store.frames.set(frameKey, { ...store.frames.get(frameKey) ?? {}, ...row });
  }
  for (const effect of response.clientEffectsByTrait ?? []) {
    if (effect.callsitePayload !== void 0) store.callsitePayloads.set(effect.traitName, effect.callsitePayload);
  }
}
function traceResponse(observer, response) {
  if (observer === void 0) return;
  for (const hop of response.transitions ?? []) {
    observer.onTransition({
      traitName: hop.trait,
      from: hop.from,
      to: hop.to,
      event: hop.event,
      ...hop.firedArm !== void 0 ? { firedArm: hop.firedArm } : {},
      ...hop.guardResult !== void 0 ? { guardResult: hop.guardResult } : {},
      effects: hop.effects,
      ...hop.observed !== void 0 ? { observed: hop.observed } : {}
    });
  }
}
function createLocalFold(opts) {
  return {
    foldLocalResponse: async (response, traceHops, notify) => {
      if (traceHops) traceResponse(opts.observer, response);
      mirrorResponse(opts.store, opts.frameKeyOf, response);
      if (notify) opts.store.notify();
    }
  };
}

export { createLocalFold, mirrorResponse, traceResponse };
