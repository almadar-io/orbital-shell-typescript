import { parseListenSource } from './chunk-IHQLE5M7.js';
import { applyListenMapping, kernelEvaluator, toWireValue } from '@almadar/core';

function listenGuardHolds(guard, payload) {
  const outcome = kernelEvaluator().evaluateGuard({ payload: toWireValue(payload ?? {}) }, guard);
  return outcome.kind === "value" && outcome.value;
}
function collectListenerTargets(traitIndex, sourceStamp, event, payload) {
  const targets = [];
  for (const [listenerName, listenerEntry] of traitIndex.byName) {
    for (const listener of listenerEntry.traitDef.listens ?? []) {
      const { bareEvent, matcher } = parseListenSource(listener, listenerEntry.orbitalName);
      if (bareEvent !== event || !matcher(sourceStamp)) continue;
      if (listener.guard !== void 0 && !listenGuardHolds(listener.guard, payload)) continue;
      targets.push({
        listenerTrait: listenerName,
        entry: listenerEntry,
        listener,
        triggers: listener.triggers,
        ...listener.triggersId !== void 0 ? { triggersId: listener.triggersId } : {},
        payload: applyListenMapping(listener.payloadMapping, payload)
      });
    }
  }
  return targets;
}

export { collectListenerTargets };
