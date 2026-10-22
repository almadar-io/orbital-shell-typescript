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
  clearSchemaCache,
  getSchemaCacheStats,
  getPage,
  getPages,
  getEntity,
  getTrait,
  pageModifiers,
} from './src/resolver';

// Embedded-trait `@config.X` forward resolution — shared by the JS
// interpreter (`@almadar/runtime`) and the render substrate (`@almadar/ui`).
export {
  collectEmbeddedTraitReferrers,
  collectTraitEmbedAdjacency,
  collectTraitConfigRefAdjacency,
  traitDeclaresConfigForward,
  buildResolvedTraitConfigs,
  traitReferencesCallsitePayload,
  collectCallsiteCaptureChildren,
  collectForwardedConfigKeys,
  collectOrbitalForwardedConfigKeys,
  traitsEmbeddedByEvent,
  configReferencesCallsitePayload,
  traitsEmbeddedByEffects,
  configForwardTokens,
  filterConfigToForwardedKeys,
  unionOrganismConfigs,
  orbitalFileOf,
  navItemHref,
} from './src/embedded-trait-config';

// Dot-notation nested value lookup — shared by `@almadar/ui` and emitted
// SERVER code (which cannot import the UI render substrate).
export { getNestedValue } from './src/lib/get-nested-value';
export { INDISTINCT_DELTA_E, themeModes, toneColor, hexToLab, ciede2000, colorDifference, type ThemeMode, type Lab } from './src/lib/theme-tone-colors';

// Listen-route `with { ... }` payload mapping — shared by the server runtime
// (`@almadar/runtime`) and the client cross-trait wiring (`@almadar/ui`).
export { applyListenPayloadMapping } from './src/listen-payload-mapping';
export { importsOf, dependencyGraphOf, DependencyGraphSchema, type BehaviorTier, type DependencyLayer, type BehaviorImport, type DependencyGraph, type DependencyGraphDeps } from './src/dependency-graph';
export type { ListenPayloadEvaluator } from './src/listen-payload-mapping';
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
  type KernelEvaluator,
  type KernelEvaluatorExports,
} from './src/kernel-evaluator';
export {
  accessDeniedMessage,
  applyRowAccess,
  checkMutationAccess,
  rowAccess,
  type AccessBindings,
  type MutationOp,
  type RowAccessBundle,
} from './src/kernel-row-access';
export type { KernelMemoryStoreWire, KernelMemoryStoreExports } from './src/kernel-memory-store';

// ML contract validation — one pure implementation for the runtime path
// (`@almadar/evaluator` contract/* operators) and the compiled TS shell.
export {
  validateContract,
  isTensorValue,
  describeTensorMismatch,
  tensorShape,
  tensorLastDimSize,
  gatherTensorLastDim,
  mapTensorLastDim,
  contractFieldName,
} from './src/ml-contract';
export type {
  TensorValue,
  ContractRange,
  ContractFieldSpec,
  ContractFieldEntry,
  ContractSpec,
  ContractViolation,
  ContractValidationResult,
} from './src/ml-contract';

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

// Export builders (compose behaviors, event wiring, layout strategy)
export {
  type LayoutStrategy,
  detectLayoutStrategy,
  type EventWiringEntry,
  applyEventWiring,
  type ComposeBehaviorsInput,
  type ComposeBehaviorsResult,
  composeBehaviors,
  ORBITAL_VALUE_IMPORT_ALIAS,
  orbitalImportFromValue,
  parseProgram,
} from './src/builders/index';

// Export state machine graph algorithms (BFS, guard payloads, replay paths)
// Note: PayloadFieldSchema is re-exported selectively to avoid collision with
// the Zod PayloadFieldSchema from types/state-machine.ts
export {
  type StateEdge,
  type BFSNode,
  type BFSPathNode,
  type ReplayStep,
  type GuardPayload,
  type GraphTransition,
  buildStateGraph,
  collectReachableStates,
  walkStatePairs,
  buildGuardPayloads,
  extractPayloadFieldRef,
  constTruth,
  buildReplayPaths,
  type ReplayTransition,
  buildEdgeCoveringWalk,
  type EdgeWalkTransition,
  type WalkStep,
} from './src/state-machine/index';

// Row-level entity access policies. Also reachable via `@almadar/core/mock`,
// but server code (generated app servers, `@almadar/server`) must not import
// through the mock door to read a production authorization contract.
export {
  type EntityAccessPolicies,
  entityAccessPolicies,
  entityAccessTable,
  orbitalInlineEntities,
} from './src/access/entityAccess';

// Declared external inputs: what an outside client may send a trait.
export { type EventAddress, type ExternalInput, externalInputsOf, findExternalInput, findInputByAddress, payloadIssues, payloadSchemaToJsonSchema, readableEntitiesOf, type PayloadIssue } from './src/access/externalInputs';

// The three kernel abilities an LLM tool loop is written with: program/inputs, program/dispatch, persist/read-named.
export { AGENT_PORT_OPERATORS, UNKNOWN_ENTITY_CODE, agentPortPayload, type AgentPortIssue, type AgentPortOperator, type AgentPortOutcome, type AgentPortResult, type AgentReflection, type DispatchAnswer, type DispatchIssue, type NamedRows, type ReflectedInput, dispatchFailureOf, dispatchOutcomeOf, isAgentPortOperator, reflectInput, runAgentPort } from './src/access/agentPorts';

// Declared inbound deliveries: the `/api/hooks/<name>` requests a program accepts.
export { type InboundAnswer, type InboundDelivery, type InboundRoute, type InboundDeclaration, type InboundVerification, constantTimeEquals, dispatchFailed, inboundOnlyMessage, inboundOnlyTrait, findInbound, inboundAnswerOf, inboundPayload, inboundRoutesOf, unknownHook } from './src/access/inbound';

// `expects` shape union — the JS composer's merge (derivation itself lives in `orb`:
// `orb behaviors expects` / `orb behaviors describe`).
export { mergeExpectationShape } from './src/expectation-shape';

// Route matching — the one path → page-pattern resolver.
export { matchPath, comparePathSpecificity, matchPathAmong, defaultPage, pathMatchesPattern } from './src/route-match';

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
