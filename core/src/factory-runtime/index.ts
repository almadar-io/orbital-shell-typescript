/**
 * `@almadar/core/factory-runtime` — pure data-driven equivalents of the
 * per-behavior TS factories that the std-ts codegen emits.
 *
 * Single canonical implementation shared by:
 * - `@almadar/std/factory-runtime` (re-exports this)
 * - `@almadar/behaviors/factory-runtime` (re-exports this)
 * - Generated factory bodies + dispatch.ts (import from here)
 *
 * Reference: `docs/Almadar_Studio_SDK.md` §7.4.
 *
 * @packageDocumentation
 */

export { extractManifest, paramFieldsFor } from './extract-manifest.js';
export {
  applyParamsToOrb,
  applyDeclarationTraitRenames,
  applyDeclarationEntityRename,
  declaredEntityName,
  healEntityLedgerRows,
  healTraitLedgerRows,
  rebindInlineTraitEntity,
  rewriteEntityInInlineTrait,
  rewriteTraitRefsInTree,
  mergeCallSiteConfigOverrides,
  validateOrbitalFactoryParams,
} from './apply-params-to-orb.js';
export type { EntityDeclarationRename, WalkableData } from './apply-params-to-orb.js';
export { applyParamsToWholeOrb } from './apply-params-to-whole-orb.js';
export type {
  OrbitalFactoryParams,
  OrbitalTraitOverride,
  ParamValidationError,
  ParamValidationResult,
} from './types.js';
export type { OrbitalParamsManifest, ParamFieldDescriptor } from './manifest-types.js';
