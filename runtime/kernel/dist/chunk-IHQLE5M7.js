// src/runtime/events/identity/routing.ts
function eventRouteKey(eventName, eventId) {
  return eventId ? `@evt:${eventId}` : eventName;
}
function buildSourceMatcher(src, listenerOrbital) {
  if (src.kind === "any") return () => true;
  if (src.kind === "trait") {
    if (src.traitId !== void 0) {
      const wantedTraitId = src.traitId;
      return (source) => !!source && source.traitId === wantedTraitId;
    }
    const wantedTrait2 = src.trait;
    return (source) => !!source && source.orbital === listenerOrbital && source.trait === wantedTrait2;
  }
  if (src.orbitalId !== void 0 && src.traitId !== void 0) {
    const wantedOrbitalId = src.orbitalId;
    const wantedTraitId = src.traitId;
    return (source) => !!source && source.orbitalId === wantedOrbitalId && source.traitId === wantedTraitId;
  }
  const wantedOrbital = src.orbital;
  const wantedTrait = src.trait;
  return (source) => !!source && source.orbital === wantedOrbital && source.trait === wantedTrait;
}
function parseListenSource(listener, listenerOrbital) {
  const explicit = listener.source;
  if (explicit && typeof explicit === "object") {
    return {
      bareEvent: listener.event,
      matcher: buildSourceMatcher(explicit, listenerOrbital)
    };
  }
  const key = listener.event;
  const parts = key.split(".");
  if (parts.length === 1) {
    return { bareEvent: key, matcher: () => true };
  }
  if (parts.length === 2) {
    const [sourceOrStar, eventName] = parts;
    if (sourceOrStar === "*") {
      return { bareEvent: eventName, matcher: () => true };
    }
    return {
      bareEvent: eventName,
      matcher: buildSourceMatcher(
        { kind: "trait", trait: sourceOrStar },
        listenerOrbital
      )
    };
  }
  if (parts.length >= 3) {
    const eventName = parts[parts.length - 1];
    const trait = parts[parts.length - 2];
    const orbital = parts.slice(0, parts.length - 2).join(".");
    return {
      bareEvent: eventName,
      matcher: buildSourceMatcher({ kind: "orbital", orbital, trait }, listenerOrbital)
    };
  }
  return { bareEvent: key, matcher: () => true };
}

export { buildSourceMatcher, eventRouteKey, parseListenSource };
