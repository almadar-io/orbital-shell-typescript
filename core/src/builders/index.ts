/**
 * Builders Module
 *
 * Reference-form builders and the plan's wiring and layout types. Composing programs into an
 * app is the Rust composer's (`orb compose`, `program/compose`).
 *
 * @packageDocumentation
 */

export { applyTraitConfigOverrides } from './apply-config-overrides.js';
export type { LayoutStrategy } from './layout-strategy.js';
export type { EventWiringEntry } from './event-wiring.js';

// Phase 4.2 reference-form builders (mirrored from ../builders.ts for the
// dual-export convention so both `@almadar/core/builders` and consumers
// that pull from `./builders/index` get the same symbols).
export {
  type MakeTraitRefOpts,
  type MakePageRefOpts,
  type MakeOrbitalWithUsesOpts,
  type MakeAtomOrbitalOpts,
  type MakeAtomOrbitalTraitOverrides,
  makeTraitRef,
  makePageRef,
  makeOrbitalWithUses,
  makeAtomOrbital,
  ORBITAL_VALUE_IMPORT_ALIAS,
  orbitalImportFromValue,
  parseProgram,
} from '../builders.js';

// LayoutTrait + slot-embedding helpers — used by std layout-shell molecules
// (std-filtered-list, std-master-detail-layout, etc.) to construct the
// canonical inline LayoutTrait that wraps embedded atom traits via @trait.X
// slot references.
export {
  type MakeLayoutTraitOpts,
  makeSlot,
  makeRenderUI,
  makeLayoutTrait,
} from './layout-trait.js';

