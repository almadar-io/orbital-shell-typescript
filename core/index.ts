/**
 * @almadar/core
 *
 * Core types and schemas for the Almadar/Orbital system.
 * This is the central type package that other packages depend on.
 *
 * @packageDocumentation
 */

// Export all types
export * from './src/types/index';

// Render-UI structural editing (contextual edit: EditFocus, RenderUiPatch, util)
export * from './src/render-ui-edit';

// Agent-trace view-model (Trace* render shapes for the studio trace UI)
export * from './src/agent-trace-view';

export { parseXml, xmlValid, XmlSyntaxError, type XmlValue, type XmlListPaths } from './src/xml';

export {
  base64EncodeBytes,
  base64DecodeBytes,
  sha256Bytes,
  hmacSha256Bytes,
  md5Bytes,
  encodeUriComponent,
  decodeUriComponent,
  encodeBase64,
  decodeBase64,
  hashSha256,
  hmacSha256,
  hashMd5,
  utf8Bytes,
  encodeDigest,
  CodecError,
  type DigestEncoding,
} from './src/codec';

// Export schema resolution functions
export {
  schemaToIR,
  getPage,
} from './src/resolver';

// Embedded-trait adjacency and `@config.X` forward facts — read by
// the render substrate (`@almadar/ui`); config itself is the kernel's.
export {
  collectTraitEmbedAdjacency,
  collectTraitConfigRefAdjacency,
  traitDeclaresConfigForward,
  traitReferencesCallsitePayload,
  collectCallsiteCaptureChildren,
  collectForwardedConfigKeys,
  collectOrbitalForwardedConfigKeys,
  traitsEmbeddedByEvent,
  configReferencesCallsitePayload,
  traitsEmbeddedByEffects,
  configForwardTokens,
  filterConfigToForwardedKeys,
  orbitalFileOf,
} from './src/embedded-trait-config';

// Dot-notation nested value lookup — shared by `@almadar/ui` and emitted
// SERVER code (which cannot import the UI render substrate).
export { getNestedValue } from './src/lib/get-nested-value';
export { INDISTINCT_DELTA_E, themeModes, toneColor, hexToLab, ciede2000, colorDifference, type ThemeMode, type Lab } from './src/lib/theme-tone-colors';

// Listen-route `with { ... }` payload mapping — shared by the server runtime
// (`@almadar/runtime`) and the client cross-trait wiring (`@almadar/ui`).
export { importsOf, dependencyGraphOf, DependencyGraphSchema, type BehaviorTier, type DependencyLayer, type BehaviorImport, type DependencyGraph, type DependencyGraphDeps } from './src/dependency-graph';
export {
  createKernelEvaluator,
  installKernelEvaluator,
  hasKernelEvaluator,
  kernelEvaluator,
  KernelEvalError,
  KernelEvaluatorNotInstalledError,
  toWireValue,
  eventPayloadOf,
  type WireInput,
  applyListenMapping,
  lazyKernelExports,
  type EventWire,
  type KernelEvaluator,
  type KernelEvaluatorExports,
} from './src/kernel-evaluator';
export {
  accessDeniedMessage,
  accessContext,
  applyRowAccess,
  checkMutationAccess,
  rowAccess,
  type AccessBindings,
  type MutationOp,
  type RowAccessBundle,
} from './src/kernel-row-access';
export type { KernelMemoryStoreWire, KernelMemoryStoreExports } from './src/kernel-memory-store';

// Export schema diffing & protection functions
export {
  diffSchemas,
  diffSchemaSemantics,
  diffOrbitalSchemas,
  isDestructiveChange,
  getRemovals,
  categorizeRemovals,
  requiresConfirmation,
  detectPageContentReduction,
  hasSignificantPageReduction,
  type SchemaDiff,
  type SchemaDiffOptions,
  type SchemaDiffMode,
  type SchemaDiffAuthor,
  type SchemaDiffSource,
  type SchemaDiffChange,
  type SchemaDiffChangeset,
  type SchemaDiffSummary,
} from './src/diff';

// Export schema summarization functions
export {
  summarizeSchema,
  summarizeOrbital,
  classifyWorkflow,
} from './src/summarize';

export * from './src/factory/index';

// Export builders (reference-form builders and the plan's wiring and layout types)
export {
  type LayoutStrategy,
  type EventWiringEntry,
  ORBITAL_VALUE_IMPORT_ALIAS,
  orbitalImportFromValue,
  parseProgram,
} from './src/builders/index';

// An orbital's inline entity definitions (access policies and entity ownership are the kernel's).
export { orbitalInlineEntities } from './src/access/entityAccess';

// Declared external inputs: what an outside client may send a trait (the kernel lists them; these are the shapes
// of its answers and the addressing and payload helpers over them).
export { type EventAddress } from './src/access/externalInputs';
export {
  type ExternalInput,
  ExternalInputSchema,
  type InboundAnswer,
  InboundAnswerSchema,
  type InboundDelivery,
  InboundFoundSchema,
  InboundOnlySchema,
  NameListSchema,
  OptionalNameSchema,
  type PayloadIssue,
  PayloadIssueSchema,
  PayloadJsonSchemaSchema,
  type InboundRoute,
  InboundRouteSchema,
  type InboundDeclaration,
  type InboundVerification,
} from './src/access/contract';

// The three kernel abilities an LLM tool loop is written with: program/inputs, program/dispatch, persist/read-named.


// Route matching — the one path → page-pattern resolver.
export { matchPath, comparePathSpecificity, matchPathAmong, defaultPage, notFoundPage, pathMatchesPattern } from './src/route-match';

// Shared-entity frame merge (mechanics-as-traits DRY primitive: the JS
// interpreter and the generated TypeScript codegen both fold mechanic
// writes through this one function).
export {
  mergeEntityFrame,
  resolveEntityView,
  omitFrameFields,
  type EntityFieldWrite,
  type EntityFrameState,
} from './src/shared-entity/merge';
export { findEntityAmongOrbitals } from './src/shared-entity/find-entity';

// Pattern registry, component mappings, and pattern utilities (merged from
// the former @almadar/patterns package to break the core ↔ patterns cycle).
export * from './src/patterns/index';

// i18n vocabulary tables for the `.lolo`/`.orb` language (English, Arabic,
// Slovenian) and the coverage gate (pattern-sync's `i18n` step imports this).
export * from './src/i18n/index';

// Theme presets — THEME_PRESETS (ThemeDefinition, one per built-in preset),
// migrated from packages/almadar-ui/themes/*.css. almadar-pattern-sync's
// `themes` step regenerates that CSS from these presets.
export * from './src/themes/index';
export { orbitalTouchesOwnRecord } from './src/data-bearing';
