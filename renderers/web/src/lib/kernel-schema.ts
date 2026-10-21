/**
 * The schema the kernel is constructed from. The kernel registers inline traits only, so the orbitals a
 * host runs are passed through core's `inlineTraitRefs`, which unwraps each `{ ref, config?, _resolved }`
 * trait wrapper and folds its call-site config onto the trait's declared knobs.
 *
 * @packageDocumentation
 */
import { inlineTraitRefs, type OrbitalDefinition } from '@almadar/core';

export function kernelOrbitals(orbitals: readonly OrbitalDefinition[]): OrbitalDefinition[] {
  return inlineTraitRefs(orbitals);
}
