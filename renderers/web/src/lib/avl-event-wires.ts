/**
 * AVL event wires — which trait hears which, decided by the kernel's own `listens {}` source rule
 * (`orbital-core` `event_wires`), so a drawn wire is a delivery the running app makes, never a name coincidence.
 */

import { kernelEvaluator, type EventWire, type OrbitalSchema } from '@almadar/core';

export type TraitEventWire = EventWire;

const wiresBySchema = new WeakMap<OrbitalSchema, TraitEventWire[]>();

/** Every emitter → listener delivery between two different traits, in schema order; asked of the kernel once per schema object. */
export function traitEventWires(schema: OrbitalSchema): TraitEventWire[] {
  const cached = wiresBySchema.get(schema);
  if (cached) return cached;
  const wires = kernelEvaluator().eventWires(schema);
  wiresBySchema.set(schema, wires);
  return wires;
}
