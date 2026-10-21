import type { OrbitalEventRequest, OrbitalEventResponse } from '@almadar/core';

/** Whether a host dispatch's response names any trait this view owns: its target, or a trait its fanout settled, wrote or painted. */
export function hostDispatchInView(request: OrbitalEventRequest, response: OrbitalEventResponse, owns: (trait: string) => boolean): boolean {
  if (request.targetTrait !== undefined && owns(request.targetTrait)) return true;
  if (Object.keys(response.states).some(owns)) return true;
  if (Object.keys(response.entityByTrait ?? {}).some(owns)) return true;
  return (response.clientEffectsByTrait ?? []).some((e) => owns(e.traitName));
}
