/**
 * At-most-once delivery: one physical emit reaches a trait once per triggered
 * event. Every key one emit fans to (scope-chain bubbling, a listen route)
 * carries the same `source` object, so the first delivery to a (trait, event)
 * claims it and the rest are the same event again. A sourceless emit is never
 * deduplicated. Shared by the runtime ingress (`useBusIngress`), `useUIEvents`
 * and compiled listens.
 */
import type { BusEventSource } from "@almadar/core";

const claims = new WeakMap<BusEventSource, Set<string>>();

export function claimDelivery(source: BusEventSource | undefined, trait: string, event: string): boolean {
  if (source === undefined) return true;
  const key = `${trait}\u0000${event}`;
  const seen = claims.get(source);
  if (seen === undefined) {
    claims.set(source, new Set([key]));
    return true;
  }
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
