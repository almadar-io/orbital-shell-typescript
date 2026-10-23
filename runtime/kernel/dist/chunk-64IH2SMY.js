// src/events/emit-stamp.ts
function stampEmitSource(source, identity) {
  const stamp = source ?? {
    orbital: identity.orbitalName,
    trait: identity.traitName
  };
  if (stamp.orbitalId === void 0 && identity.orbitalId !== void 0) {
    stamp.orbitalId = identity.orbitalId;
  }
  if (stamp.traitId === void 0 && identity.traitId !== void 0) {
    stamp.traitId = identity.traitId;
  }
  if (stamp.eventId === void 0 && identity.emitContractEventId !== void 0) {
    stamp.eventId = identity.emitContractEventId;
  }
  if (identity.originClientId !== void 0 && stamp.originClientId === void 0) {
    stamp.originClientId = identity.originClientId;
  }
  return stamp;
}

export { stampEmitSource };
