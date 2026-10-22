export type {
  FactoryConfigParam,
  FactoryConfigTier,
  FactorySignatureEntityField,
  FactoryEntitySignature,
  FactoryEventSignature,
  FactoryTraitSignature,
  FactoryPageSignature,
  FactorySignature,
  FactoryExposure,
  FactoryProvenance,
  FactorySignatureCatalog,
  FactoryCallSite,
  FactoryCallSiteParams,
  FactoryParamValue,
  SchemaFieldType,
  JsonSchema,
  JsonSchemaType,
  JsonValue,
} from './types.js';

export { rehydrateKnobDefs } from './knob-defs.js';
export type {
  DomainQuestion,
  DomainQuestionAnswer,
  DomainQuestionAnswers,
  DomainQuestionInputType,
  FactoryCallPlanMutationTemplate,
} from './questions/index.js';
export {
  deriveInputType,
  factoryCallPlanOrbitalName,
  generateQuestions,
  humanizeKey,
  answerToMutations,
  answersToMutations,
} from './questions/index.js';

export type {
  PresentationOverlay,
  PresentationNavItem,
  TraitOverlay,
  TraitOverlayEntry,
  TraitOverlayListener,
  RuleOverlay,
  RuleOverlayEntry,
  OwnershipOverlayEntry,
} from './overlays.js';

export {
  applyFactoryCallPlanMutation,
} from './mutate.js';
export type {
  FactoryCallPlanMutation,
  FactoryCallPlanState,
  OrbitalCallInput,
} from './mutate.js';

export {
  ENTITY_FIELD_SCHEMA,
  signatureToParamsSchema,
  assertNoUnsatisfiableEnum,
} from './params-schema.js';
export {
  assembleComposition,
  blockContractOf,
  checkComposition,
  compositionSpecOf,
  decomposeOrbital,
  bindsRecord,
  followEventName,
  resolveBlockContract,
  type CompositionBlock,
  type CompositionBlockContract,
  type CompositionContext,
  type CompositionEntity,
  type CompositionIssue,
  type CompositionIssueCode,
  type CompositionLayoutNode,
  type CompositionResult,
  type CompositionSpecOfResult,
  type CompositionSpec,
  type CompositionWire,
  type ResolvedBlockContract,
} from './composition.js';
