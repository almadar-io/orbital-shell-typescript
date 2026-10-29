import type { OrbitalEventRequest, OrbitalEventResponse } from '@almadar/core';

/**
 * Whether a host dispatch's response names any trait this view owns: its target, or a trait its fanout settled or painted,
 * or a frame it writes (`ownsFrame`, a frame key: a trait's own frame or a `$shared::<Entity>` frame).
 */
export function hostDispatchInView(
  request: OrbitalEventRequest,
  response: OrbitalEventResponse,
  owns: (trait: string) => boolean,
  ownsFrame: (frame: string) => boolean,
): boolean {
  if (request.targetTrait !== undefined && owns(request.targetTrait)) return true;
  if (Object.keys(response.states).some(owns)) return true;
  const written = (response.frames?.ops ?? []).flatMap((op) => (op[0] === 'set' ? Object.keys(op[1]) : op[0] === 'clear' ? [] : [op[1]]));
  if (written.some(ownsFrame)) return true;
  return (response.clientEffectsByTrait ?? []).some((e) => owns(e.traitName));
}
