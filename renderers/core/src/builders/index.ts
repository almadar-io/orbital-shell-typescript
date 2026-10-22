/**
 * Builders Module
 *
 * Composing orbital definitions into applications. Core owns these: `@almadar/runtime`'s
 * `effects/composition` still carries an older copy of `composeBehaviors` / event wiring /
 * layout detection for the `behavior/compose` effect (ledger: converge it onto this module).
 *
 * @packageDocumentation
 */

// Layout strategy detection
export { type LayoutStrategy, detectLayoutStrategy } from './layout-strategy.js';

// Event wiring
export { type EventWiringEntry, applyEventWiring } from './event-wiring.js';

// Compose behaviors (main entry point)
export {
  type ComposeBehaviorsInput,
  type ComposeBehaviorsResult,
  asDefinitions,
  composeBehaviors,
  mergeLedgers,
} from './compose-behaviors.js';

// An app composed from its per-orbital files (rabit's composer, the studio's app load, seeding)
export {
  type ComposeAppFromFilesOptions,
  type ComposeAppFromFilesResult,
  type ComposedSurface,
  type ComposeSurfaceOptions,
  type ConfigNavItemsNarrowResult,
  type IdentityDedupeResult,
  type IdentityDemotion,
  type IdentityExpectsRewrite,
  type IdentityRelationRetarget,
  type IdentityRoleUnion,
  type LandingNavResult,
  type OrganismRename,
  type UnrenamableCollision,
  type NavItemsNarrowResult,
  type SurfaceRename,
  asEntityObject,
  composeAppFromFiles,
  composeOrbitalSurface,
  dedupeComposedIdentity,
  identityVocabularyDelta,
  type IdentityVocabularyDelta,
  dedupeComposedSurface,
  orbitalEntityName,
  orbitalImportResolver,
  organismOrderResolver,
} from './compose-app.js';
export { type EntityRenameBlocker, type RenameEntityOptions, atomTraitResolver, entityRenameBlockers, renameEntity, renameEntityInSchema, renameOrbital } from './rename-entity.js';
export { orbitalRouteSlug } from './route-slug.js';
export { collectOwnedSurface, findDanglingRefs } from './owned-surface.js';
export {
  type FieldBindingContext,
  collectFieldComparisonLiterals,
  collectOwnerComparedFields,
  collectOwnerStampedFields,
} from './field-comparison-literals.js';

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

