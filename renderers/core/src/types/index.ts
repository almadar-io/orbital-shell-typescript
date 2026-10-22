/**
 * Orbitals Types Module (Self-Contained)
 *
 * Central export for all orbital type definitions.
 * NO imports from ../../schema/ - completely self-contained.
 *
 * @packageDocumentation
 */

// ============================================================================
// Core Types
// ============================================================================

// Orbital - the atomic building block
export {
  type Orbital,
  type OrbitalDefinition,
  type OrbitalUnit, // Backward compatibility
  type EventListener,
  type OrbitalInput,
  // Use Declaration (Import System)
  type UseDeclaration,
  UseDeclarationSchema,
  type LazyPage,
  LazyPageSchema,
  // Expect Declaration (Consumer-Side Requirements)
  type ExpectDeclaration,
  ExpectDeclarationSchema,
  type ExpectationDiagnostic,
  ExpectationDiagnosticSchema,
  type OrganismExpectations,
  OrganismExpectationsSchema,
  // Entity/Page reference types
  type EntityRef,
  type EntityCall,
  type PageRef,
  type PageRefObject,
  // Orbital reference types (import system, Stage A)
  type OrbitalRefObject,
  // Computed Event Types (Trait-Centric Model)
  type EventSource,
  type ComputedEventContract,
  type ComputedEventListener,
  OrbitalSchema as OrbitalZodSchema, // Zod schema for validating Orbital
  OrbitalUnitSchema, // Backward compatibility
  OrbitalDefinitionSchema,
  // Entity/Page reference schemas
  EntityRefSchema,
  EntityRefStringSchema,
  EntityCallSchema,
  PageRefSchema,
  PageRefStringSchema,
  PageRefObjectSchema,
  // Orbital reference schemas
  OrbitalRefStringSchema,
  OrbitalRefObjectSchema,
  EventListenerSchema,
  EventSourceSchema,
  ComputedEventContractSchema,
  ComputedEventListenerSchema,
  // Type guards
  isOrbitalDefinition,
  isEntityReference,
  isEntityReferenceAny,
  isEntityCall,
  isPageReference,
  isPageReferenceString,
  isPageReferenceObject,
  // Reference parsing utilities
  parseEntityRef,
  parsePageRef,
  parseImportedTraitRef,
  parseOrbitalRef,
  isImportedTraitRef,
  unwrapTraitRef,
  inlineTraitRefs,
  // Expectation accessors
  expectedEntityName,
} from "./orbital.js";

// OrbitalSchema - top-level app definition
export {
  type OrbitalSchema,
  type OrbitalSchema as AppSchema, // Alias
  type OrbitalSchemaWithTraits,
  type OrbitalSchemaInput,
  type SchemaMetadata,
  type MessageCatalogs,
  type ConfigProvenanceRecord,
  OrbitalSchemaSchema,
  type SiteMeta,
  SiteMetaSchema,
  HOST_SIGN_IN_ROUTE,
  isHostSignInRoute,
  SchemaMetadataSchema,
  ConfigProvenanceRecordSchema,
  parseOrbitalSchema,
  safeParseOrbitalSchema,
} from "./schema.js";

// Backward compatibility alias - FullOrbitalUnit is just Orbital
export type { Orbital as FullOrbitalUnit } from "./orbital.js";

// Identity model (V4) - branded node ids + name ledger
export {
  type OrbitalId,
  type EntityId,
  type TraitId,
  type EventId,
  type PageId,
  type ServiceId,
  type ThemeId,
  type PaletteEntryId,
  type IdKind,
  type IdForKind,
  type LedgerKind,
  type LedgerEntry,
  type IdentityLedger,
  mintId,
  deriveId,
  isOrbitalId,
  asOrbitalId,
  isEntityId,
  asEntityId,
  isTraitId,
  asTraitId,
  isEventId,
  asEventId,
  isPageId,
  asPageId,
  isServiceId,
  asServiceId,
  isThemeId,
  asThemeId,
  isPaletteEntryId,
  asPaletteEntryId,
  ledgerResolveName,
  ledgerRename,
  ledgerCurName,
  OrbitalIdSchema,
  EntityIdSchema,
  TraitIdSchema,
  EventIdSchema,
  PageIdSchema,
  ServiceIdSchema,
  ThemeIdSchema,
  PaletteEntryIdSchema,
  LedgerKindSchema,
  LedgerEntrySchema,
  IdentityLedgerSchema,
  idPrefix,
  idKindOf,
} from "./identity.js";

// Entity - data nucleus
export {
  type Entity,
  type OrbitalEntity, // Backward compatibility
  type EntityPersistence,
  type OrbitalEntityInput,
  EntitySchema,
  OrbitalEntitySchema, // Backward compatibility
  EntityPersistenceSchema,
  deriveCollection,
  isRuntimeEntity,
  isClientResident,
  storesRowsInBrowser,
  instancesForLocale,
  persistenceModeAllowsOverrides,
  isFieldValue,
  type FieldValue,
  FieldValueSchema,
  type ControlValue,
  type EntityRow,
  EntityRowSchema,
  type EntityWith,
  type EntityData,
} from "./entity.js";

// Page - trait-driven UI entry
export {
  type Page,
  type OrbitalPage, // Backward compatibility
  type PageTraitRef,
  type ViewType,
  type OrbitalPageInput,
  type OrbitalPageStrictInput,
  PageSchema,
  OrbitalPageSchema, // Backward compatibility
  OrbitalPageStrictSchema,
  PageTraitRefSchema,
  ViewTypeSchema,
  type PageAccess,
  type PageIndexing,
  type PageMeta,
  PageAccessSchema,
  PageIndexingSchema,
  PageMetaSchema,
  type PageModifiers,
  PageModifiersSchema,
  resolvePageMeta,
} from "./page.js";

// ============================================================================
// Field Types
// ============================================================================

export {
  type Field,
  type EntityField, // Backward compatibility
  type ScalarEntityField,
  type EnumEntityField,
  type RelationEntityField,
  type ArrayEntityField,
  type ObjectEntityField,
  type FieldType,
  type FieldTag,
  type TypeVariable,
  type TypeVariableEntityField,
  type SemanticStringType,
  FIELD_TYPES,
  FieldTagSchema,
  TypeVariableSchema,
  isTypeVariable,
  isTypeVariableField,
  TYPE_POSITION_ONLY,
  SEMANTIC_STRING_TYPES,
  isSemanticStringType,
  isSemanticStringValue,
  type FileValue,
  FileValueSchema,
  isFileValue,
  isEmailValue,
  SEMANTIC_STRING_PATTERNS,
  isUrlValue,
  isPhoneValue,
  isUuidValue,
  type RelationConfig,
  type EntityFieldInput,
  FieldSchema,
  EntityFieldSchema, // Backward compatibility
  FieldTypeSchema,
  RelationConfigSchema,
} from "./field.js";
export { FieldProjectionSchema, type FieldProjection } from "./projection.js";

// ============================================================================
// S-Expression Types
// ============================================================================

export {
  // Types
  type SExpr,
  type SExprAtom,
  type SExprObject,
  type Expression,
  type ParsedBinding,
  type CoreBinding,
  type SExprInput,
  type ExpressionInput,
  // Schemas
  SExprSchema,
  SExprDataSchema,
  SExprAtomSchema,
  ExpressionSchema,
  // Type guards
  isSExpr,
  isSExprAtom,
  isBinding,
  isSExprCall,
  isValidBinding,
  // Utilities
  parseBinding,
  getOperator,
  getArgs,
  formatSExpr,
  type SExprPath,
  type EvalStep,
  type EvalTrace,
  sexpr,
  walkSExpr,
  isStaticallyFalse,
  collectBindings,
  // Constants
  CORE_BINDINGS,
  // quote — an S-expression held as data (G-CROSS-041)
  QUOTE_HEAD,
  encodeQuoteBody,
  decodeQuoteBody,
  quoteExpr,
  quoteBodyOf,
  decodeQuotedValue,
  QUASIQUOTE_HEAD,
  UNQUOTE_HEAD,
  quasiquoteExpr,
  quasiquoteOf,
  instantiateQuasiquote,
  toProgramData,
  // Runtime evaluation types
  type EvalContext,
  type EventPayload,
  type EventPayloadValue,
  EventPayloadSchema,
  EventPayloadValueSchema,
  isEventPayloadValue,
  type LogMeta,
  type LogMetaValue,
} from "./expression.js";

// Observability: structured log lines and call records (a deployment's topology is read from these)
export {
  type CallKind,
  type CallRecord,
  type LogContext,
  type LogSeverity,
  type StructuredLogEntry,
  CALL_KINDS,
  LOG_SEVERITIES,
  isCallRecord,
  isStructuredLogEntry,
} from "./observability.js";

// ============================================================================
// S-Expression Bindings
// ============================================================================

export {
  // Schemas
  BindingSchema,
  // Constants
  BINDING_DOCS,
  BINDING_CONTEXT_RULES,
  RENDER_BINDING_MARKER,
  // Types
  type BindingContext,
  type RenderBindingMarker,
  // Helpers
  validateBindingInContext,
  getBindingExamples,
  isRenderBindingMarker,
  containsEntityBinding,
  containsPayloadBinding,
} from "./bindings.js";

export {
  RowSetRefSchema,
  ROW_SET_MARKER,
  rowSetMarker,
  isRowSetMarker,
  type RowSetRef,
  type RowSetMarker,
} from "./row-set.js";

// Binding root classification (narrow union + helper). Complements the
// `parseBinding` / `ParsedBinding` shapes exported from ./expression.js
// (which return `root: string`) — use `toBindingRoot(parsed.root)` to
// narrow to the exhaustive `BindingRoot` union.
export {
  BINDING_ROOTS,
  toBindingRoot,
  type BindingRoot,
  type TraitFieldRef,
  TraitFieldRefSchema,
  isTraitFieldRef,
} from "./binding.js";

// Authenticated user context — the shape `@user.x` resolves against, shared by
// the JS interpreter and the compiled shell.
export {
  ANONYMOUS_USER,
  DEFAULT_VIEWER,
  findPersonaInRoster,
  normalizeUserContext,
  personaFromIdentityRow,
  resolveDefaultViewer,
  resolvePersonaSpec,
  type UserContext,
  type Viewer,
  ViewerSchema,
  type Claim,
  type ViewerAuthority,
  type RawUserClaims,
  RawUserClaimsSchema,
} from "./user.js";

// ============================================================================
// State Machine Types
// ============================================================================

export {
  type State,
  type Event,
  type Guard,
  type Transition,
  type StateMachine,
  type PayloadField,
  type PayloadTypeWhen,
  type PayloadTypeContainer,
  payloadTypeContainer,
  type StateInput,
  type EventInput,
  type GuardInput,
  type TransitionInput,
  type StateMachineInput,
  StateSchema,
  EventSchema,
  GuardSchema,
  TransitionSchema,
  StateMachineSchema,
  PayloadFieldSchema,
  PayloadTypeWhenSchema,
  // Event utilities
  isCircuitEvent,
} from "./state-machine.js";

// ============================================================================
// Effect Types
// ============================================================================

export {
  // Core types
  type Effect,
  type EffectInput,
  type TypedEffect,
  SERVER_REPORTED_EFFECTS,
  type ServerReportedEffect,
  type NamespacedEffectName,
  type UISlot,
  type PatternConfig,
  type TemplatePatternConfig,
  type CallServiceConfig,
  type EmitConfig,
  // Typed effect tuples (per-operator tuple shapes)
  type RenderBinding,
  type RenderUIEffect,
  type NavigateEffect,
  type NavigateOptions,
  type NavigateBackEffect,
  type EmitEffect,
  type SetEffect,
  type PersistEffect,
  type PersistBatchOperation,
  isPersistBatchOperation,
  type FetchEffect,
  type FetchStreamEffect,
  type FetchStreamOptions,
  type CallServiceEffect,
  type CancelCallEffect,
  type RandomBytesEffect,
  type RandomBytesPayload,
  type CredentialStatusEffect,
  type CredentialForgetEffect,
  type CredentialPayload,
  type AccessCheckEffect,
  type AccessCheckRequest,
  type AccessCheckPayload,
  type CredentialAdminOperator,
  type CredentialAdminEffect,
  type CredentialListEntry,
  type CredentialServiceStatus,
  type CredentialListPayload,
  type CredentialSetPayload,
  type CredentialRemovePayload,
  type CredentialTestPayload,
  type CredentialModePayload,
  type CredentialRotatePayload,
  type CredentialAdminFailure,
  type OAuthProviderWord,
  type OAuthOp,
  type OAuthEndpointWord,
  type OAuthClient,
  type OAuthAuthorizeOptions,
  type OAuthAuthorizeEffect,
  type OAuthConnectionStatusEffect,
  type OAuthConnectionForgetEffect,
  type OAuthAuthorizePayload,
  type OAuthConnectionPayload,
  type OAuthEffectFailurePayload,
  type OAuthAuthorizeFailurePayload,
  type OAuthDiscoveryPayload,
  type OAuthCodePayload,
  type OAuthRefreshPayload,
  type OAuthRevokePayload,
  type OAuthUserinfoPayload,
  type OAuthConnectPayload,
  type HostCallEmitConfig,
  type HttpEffect,
  type HttpCall,
  type HttpPresignedPayload,
  type HttpMethod,
  type HttpReplyPayload,
  type HttpPagedPayload,
  type HttpFailurePayload,
  type HttpFailurePhase,
  type HttpOAuthFailureCode,
  type HttpOAuthFailureReason,
  type HttpStreamEvent,
  type HttpBeaconPayload,
  type PageFactField,
  type BrowserPageFacts,
  type BrowserPageFactsEffect,
  type BrowserBeaconEffect,
  type BrowserTabEffect,
  type BrowserTabOperator,
  type BrowserTabFailureKind,
  type BrowserTabFailurePayload,
  type BrowserTabElement,
  type BrowserTabElementRef,
  type BrowserTabCapture,
  type BrowserPromptEffect,
  type BrowserEmbedEffect,
  type BrowserPromptPayload,
  type BrowserEmbedPayload,
  type OnDeviceFailureKind,
  type OnDeviceFailurePayload,
  type OnDeviceModelPort,
  type OnDeviceEmbedderPort,
  type OnDeviceModelPorts,
  type SpawnEffect,
  type DespawnEffect,
  type LogEffect,
  type DoEffect,
  type RenderItemLambda,
  type RenderChildrenMap,
  // Resource effect types
  type RefEffect,
  type DerefEffect,
  type SwapEffect,
  type WatchEffect,
  type AtomicEffect,
  type WatchOptions,
  type FetchOptions,
  type FetchResult,
  type PersistEmitConfig,
  type CallServiceEmitConfig,
  type PersistData,
  type ForwardEffect,
  type TrainEffect,
  type EvaluateEffect,
  type ForwardConfig,
  type TrainConfig,
  type EvaluateConfig,
  type NnLayer,
  type NnConfig,
  type CheckpointSaveEffect,
  type CheckpointLoadEffect,
  // Agent effect type
  type AgentEffect,
  // OS effect type
  type OsEffect,
  // Agent-path operator effect types
  type LlmEffect,
  type BehaviorReflectionEffect,
  type ProgramEffect,
  type AgentPortEffect,
  type SessionEffect,
  type TraceEffect,
  type MemoryEffect,
  type ApplicationEffect,
  type NotifyEffect,
  type SendServerEffect,
  type NnSetWeightsEffect,
  type TrainLoopEffect,
  type TrainStepEffect,
  type TrainClipGradientsEffect,
  type TrainClipWeightsEffect,
  type TrainSgdEffect,
  type TrainAdamEffect,
  type ProbSeedEffect,
  type ProbConditionEffect,
  type WorkspaceWriteOrbitalEffect,
  type WorkspaceWriteFileEffect,
  type WorkspaceWriteSchemaEffect,
  type WorkspaceWritePlanEffect,
  type WorkspaceArchiveOrbitalEffect,
  EFFECT_OPERATORS,
  EFFECT_OPERATOR_FAMILIES,
  type EffectOperator,
  type EffectOperatorFamily,
  type EffectOperatorsInSync,
  // Schemas
  UI_SLOTS,
  RENDERED_SLOTS,
  EffectSchema,
  UISlotSchema,
  // Type guards
  isEffect,
  isSExprEffect,
  // Effect builders (S-expression style)
  set,
  emit,
  navigate,
  navigateBack,
  renderUI,
  persist,
  callService,
  spawn,
  despawn,
  doEffects,
  // Resource effect builders
  ref,
  deref,
  swap,
  watch,
  atomic,
  // Runtime pattern types
  type ResolvedPatternProps,
  ResolvedPatternPropsSchema,
  PatternConfigSchema,
  PatternObjectSchema,
  type RenderUINode,
} from "./effect.js";

// ============================================================================
// Agent Types
// ============================================================================

export {
  type AgentContext,
  type AgentMemoryRecord,
  type AgentMemoryCategory,
  type AgentCompactStrategy,
  type AgentCompactResult,
  type AgentGenerateOptions,
  type AgentCodeSearchResult,
  type LlmMessage,
  type LlmToolCall,
  type LlmToolDef,
  type LlmCallToolsResult,
  type LlmTokenUsage,
  type ValidateResult,
  type RepairResult,
  type PlannerResult,
  type ExecutePlanResult,
  type DispatchUpdatesResult,
  type ServiceCallResult,
  type SessionHistoryEntry,
  isSessionHistoryEntry,
  type LlmContext,
  type WorkspaceContext,
  type SessionContext,
  type MemoryContext,
  type TraceContext,
} from "./agent.js";

// ============================================================================
// Plan & Analysis Types (lifted from @almadar-io/rabit)
// ============================================================================

export {
  type ClarificationLevel,
  type ClarificationCandidate,
  type Clarification,
  type AnalysisPageOverride,
  type ExtraTraitRef,
  type AnalysisOrbitalParams,
  type AnalysisOrbital,
  type AnalysisRename,
  type ComplexityAssessment,
  type AnalysisResult,
  type SpawnResult,
  type PlanSnapshotStatus,
  type PlanSnapshot,
  isPlanSnapshot,
  type ComposeOptions,
} from "./plan.js";

// ============================================================================
// Trait Types
// ============================================================================

export {
  type Trait,
  type TraitRef,
  type TraitReference,
  type TraitCategory,
  type TraitConfig,
  type TraitConfigObject,
  type TraitConfigValue,
  type ConfigFieldDeclaration,
  type ConfigFieldItemsDeclaration,
  type DeclaredTraitConfig,
  REFERENCE_CONFIG_TYPES,
  type ReferenceConfigType,
  isReferenceConfigType,
  SECRET_CONFIG_TYPES,
  type SecretConfigType,
  isSecretConfigType,
  maskSecretConfigValues,
  overrideDeclaredKnobs,
  type CallSiteConfigEntry,
  type CallSiteConfig,
  isCallSiteConfigDeclaration,
  isConfigRedeclaration,
  isConfigFieldSchema,
  mergeCallSiteConfigOverrides,
  normalizeCallSiteConfigToValues,
  CONFIG_REF_EVENT_PATTERN,
  configRefEventKnob,
  type ConfigRefEventError,
  resolveConfigRefEventName,
  TraitConfigSchema,
  TraitConfigValueSchema,
  ConfigFieldDeclarationSchema,
  DeclaredTraitConfigSchema,
  type TraitEventListener,
  type ListenSource,
  splitEventAddress,
  joinEventAddress,
  type TraitTick,
  type TraitDataEntity,
  type TraitEntityField,
  type RequiredField,
  type TraitUIBinding,
  type PresentationType,
  type TraitInput,
  type TraitReferenceInput,
  // Event Contract Types (Trait-Centric Model)
  type EventScope,
  type EventPayloadField,
  type TraitEventContract,
  // Backward compatibility
  type OrbitalTraitRef,
  // Rebindable entity binding contract
  type EntityFieldContract,
  // Client dispatch strategy (mirrors orbital-core runtime::dispatch_mode)
  type DispatchMode,
  DispatchModeSchema,
  computeDispatchMode,
  computeTraitDispatchMode,
  // Schemas
  TraitSchema,
  EntityFieldContractSchema,
  TraitRefSchema,
  TraitReferenceSchema,
  TraitCategorySchema,
  TraitEventListenerSchema,
  ListenSourceSchema,
  TraitUIBindingSchema,
  TickIntervalSchema,
  TraitTickSchema,
  TraitDataEntitySchema,
  TraitEntityFieldSchema,
  RequiredFieldSchema,
  OrbitalTraitRefSchema, // Backward compatibility
  // Event Contract Schemas (Trait-Centric Model)
  EventScopeSchema,
  EventPayloadFieldSchema,
  TraitEventContractSchema,
  // Helpers
  isInlineTrait,
  getTraitName,
  getTraitConfig,
  normalizeTraitRef,
} from "./trait.js";

// ============================================================================
// Domain Types
// ============================================================================

export {
  type DomainContext,
  type DomainCategory,
  type GameSubCategory,
  type NodeClassification,
  type StateSemanticRole,
  type EventSemanticRole,
  type EntitySemanticRole,
  type UserPersona,
  type DesignPreferences,
  type DesignTokens,
  type CustomPatternDefinition,
  type CustomPatternMap,
  type AllowedCustomComponent,
  type DomainContextInput,
  type DesignPreferencesInput,
  type UserPersonaInput,
  type DesignTokensInput,
  type CustomPatternDefinitionInput,
  type CustomPatternMapInput,
  // New types for UX Enhancement
  type DomainVocabulary,
  type UXHints,
  type RelatedLink,
  type SuggestedGuard,
  // Theme types
  type ThemeTokens,
  type ThemeVariant,
  type ThemeDefinition,
  type ThemeRef,
  type NavItem,
  type NavStackEntry,
  // Skin axis sub-interfaces (Layer 1 visual variation)
  type SpacingScale,
  type DensityTokens,
  type TypeScaleEntry,
  type TypeSlot,
  type TypeSizeKey,
  type TypeWeight,
  type TypeIntent,
  type TypeScale,
  type TypeIntentMap,
  type TypeScaleTokens,
  type MotionDurationKey,
  type MotionEasingKey,
  type MotionIntent,
  type MotionDurationPalette,
  type MotionEasingPalette,
  type MotionIntentMap,
  type MotionTokens,
  type IconFamily,
  type IconographyTokens,
  type ElevationTokens,
  type GeometryTokens,
  type ColorTokens,
  type ColorTokenKey,
  type IllustrationTokenKey,
  type KeysComplete,
  type IllustrationStyle,
  type IllustrationTokens,
  type SurfaceTokens,
  type DiagramTokens,
  type DiagramTokenKey,
  type DiagramLineCap,
  type DiagramLineJoin,
  type DiagramFillStyle,
  type DiagramMarker,
  type DiagramLabelFont,
  type DiagramLabelCase,
  type SceneTokens,
  type SceneTokenKey,
  type MotionShapeTokens,
  type EnterAnimation,
  type EnterDelayStep,
  type MotionEntryTokens,
  // SkinSpec composed type + slice aliases (doc §2.3 vocabulary)
  type SkinSpec,
  type ColorSlice,
  type DensitySlice,
  type TypeSlice,
  type GeometrySlice,
  type ElevationSlice,
  type MotionSlice,
  type IconographySlice,
  type IllustrationSlice,
  type SurfaceSlice,
  ALLOWED_CUSTOM_COMPONENTS,
  AGENT_DOMAIN_CATEGORIES,
  type AgentDomainCategory,
  AgentDomainCategorySchema,
  DomainContextSchema,
  DomainCategorySchema,
  GameSubCategorySchema,
  NodeClassificationSchema,
  StateSemanticRoleSchema,
  EventSemanticRoleSchema,
  EntitySemanticRoleSchema,
  UserPersonaSchema,
  DesignPreferencesSchema,
  DesignTokensSchema,
  CustomPatternDefinitionSchema,
  CustomPatternMapSchema,
  // New schemas for UX Enhancement
  DomainVocabularySchema,
  UXHintsSchema,
  RelatedLinkSchema,
  SuggestedGuardSchema,
  // Theme schemas
  ThemeTokensSchema,
  ThemeVariantSchema,
  ThemeDefinitionSchema,
  ThemeRefSchema,
  ThemeRefStringSchema,
  isThemeReference,
  isThemeRegistryKey,
  themeDataKey,
  // Skin axis schemas (Layer 1 visual variation)
  SpacingScaleSchema,
  DensityTokensSchema,
  TypeScaleEntrySchema,
  TypeSlotSchema,
  TypeSizeKeySchema,
  TypeWeightSchema,
  TypeIntentSchema,
  TypeScaleSchema,
  TypeIntentMapSchema,
  TypeScaleTokensSchema,
  MotionDurationKeySchema,
  MotionEasingKeySchema,
  MotionIntentSchema,
  MotionDurationPaletteSchema,
  MotionEasingPaletteSchema,
  MotionIntentMapSchema,
  MotionTokensSchema,
  IconFamilySchema,
  IconographyTokensSchema,
  ElevationTokensSchema,
  GeometryTokensSchema,
  ColorTokensSchema,
  COLOR_TOKEN_KEYS,
  ILLUSTRATION_TOKEN_KEYS,
  IllustrationStyleSchema,
  IllustrationTokensSchema,
  SurfaceTokensSchema,
  DiagramTokensSchema,
  DIAGRAM_TOKEN_KEYS,
  DiagramLineCapSchema,
  DiagramLineJoinSchema,
  DiagramFillStyleSchema,
  DiagramMarkerSchema,
  DiagramLabelFontSchema,
  DiagramLabelCaseSchema,
  SceneTokensSchema,
  SCENE_TOKEN_KEYS,
  MotionShapeTokensSchema,
  ENTER_ANIMATIONS,
  ENTER_DELAY_STEPS,
  EnterAnimationSchema,
  MotionEntryTokensSchema,
  isWellFormedFontStack,
  // SkinSpec composed schema + slice schemas (doc §2.3 vocabulary)
  SkinSpecSchema,
  ColorSliceSchema,
  DensitySliceSchema,
  TypeSliceSchema,
  GeometrySliceSchema,
  ElevationSliceSchema,
  MotionSliceSchema,
  IconographySliceSchema,
  IllustrationSliceSchema,
  SurfaceSliceSchema,
} from "./domain.js";

// ============================================================================
// Interaction Model
// ============================================================================

export {
  type InteractionModel,
  type CreateFlow,
  type EditFlow,
  type ViewFlow,
  type DeleteFlow,
  type ListInteraction,
  type InteractionModelInput,
  InteractionModelSchema,
  DEFAULT_INTERACTION_MODELS,
  getInteractionModelForDomain,
} from "./interaction-model.js";

// ============================================================================
// Service Types
// ============================================================================

export {
  type ServiceType,
  type ServiceDefinition,
  type RestServiceDef,
  type SocketServiceDef,
  type McpServiceDef,
  type RestAuthConfig,
  type SocketEvents,
  type ServiceRef,
  type ServiceRefObject,
  SERVICE_TYPES,
  ServiceTypeSchema,
  ServiceDefinitionSchema,
  RestServiceDefSchema,
  SocketServiceDefSchema,
  McpServiceDefSchema,
  RestAuthConfigSchema,
  SocketEventsSchema,
  ServiceRefSchema,
  ServiceRefObjectSchema,
  ServiceRefStringSchema,
  isRestService,
  isSocketService,
  isMcpService,
  isServiceReference,
  isServiceReferenceObject,
  parseServiceRef,
  getServiceNames,
  findService,
  hasService,
  type ServiceParams,
  type ServiceParamsValue,
  type CredentialIdentity,
  credentialStorageKey,
  resolveCredentialStatusIdentity,
  credentialStatusConnected,
} from "./service.js";

export {
  FS_MODES,
  NET_KINDS,
  STDIO_KINDS,
  SYS_KINDS,
  DESKTOP_KINDS,
  type FsMode,
  type NetKind,
  type StdioKind,
  type SysKind,
  type DesktopKind,
  type FsGrant,
  type NetGrant,
  type OsGrants,
  type Deployment,
  FsModeSchema,
  NetKindSchema,
  StdioKindSchema,
  SysKindSchema,
  DesktopKindSchema,
  FsGrantSchema,
  NetGrantSchema,
  OsGrantsSchema,
  DeploymentSchema,
  unionOsGrants,
} from "./os-grants.js";

// ============================================================================
// Pattern Types
// ============================================================================

export {
  type PatternType,
  PATTERN_TYPES,
  PatternTypeSchema,
  isValidPatternType,
} from "./pattern.js";

// ============================================================================
// Asset Types
// ============================================================================

export {
  // Constants
  ENTITY_ROLES,
  VISUAL_STYLES,
  CAMERA_MODES,
  ASSET_DIMENSIONS,
  ASSET_ASPECTS,
  FX_KINDS,
  ANIMATION_NAMES,
  SPRITE_DIRECTIONS,
  SHEET_PROJECTIONS,
  // Types
  type EntityRole,
  type VisualStyle,
  type AssetDimension,
  type AssetAspect,
  type FxKind,
  type AnimationName,
  type SpriteDirection,
  type SheetProjection,
  type AnimationDef,
  type SpriteSheetAtlas,
  type SubTexture,
  type TextureAtlas,
  type Tilesheet,
  type SemanticAssetRef,
  type Asset,
  type ScenePos,
  type Camera,
  type CameraMode,
  type AssetCatalogEntry,
  type AssetCatalog,
  type AssetUrl,
  type SemanticAssetRefInput,
  type AnimationDefInput,
  type AssetCatalogEntryInput,
  type SpriteSheetAtlasInput,
  type SpriteSheetLayout,
  type ManifestEntryKind,
  type ManifestCanvasAffinity,
  type ManifestSourceCatalog,
  type ManifestAssetLicense,
  type ManifestFrameSpec,
  type ManifestEntry,
  type ManifestEntryInput,
  type SoundEntry,
  type AudioManifest,
  // Schemas
  EntityRoleSchema,
  VisualStyleSchema,
  AssetDimensionSchema,
  AssetAspectSchema,
  FxKindSchema,
  AnimationNameSchema,
  SpriteDirectionSchema,
  SheetProjectionSchema,
  AnimationDefSchema,
  SpriteSheetAtlasSchema,
  SoundEntrySchema,
  AudioManifestSchema,
  SubTextureSchema,
  TextureAtlasSchema,
  TilesheetSchema,
  SemanticAssetRefSchema,
  AssetSchema,
  ScenePosSchema,
  CameraModeSchema,
  CameraSchema,
  AssetCatalogEntrySchema,
  AssetCatalogSchema,
  ManifestEntryKindSchema,
  ManifestCanvasAffinitySchema,
  ManifestSourceCatalogSchema,
  ManifestAssetLicenseSchema,
  ManifestFrameSpecSchema,
  ManifestEntrySchema,
  // Constants
  SPRITE_SHEET_LAYOUT,
  DEFAULT_UNIT_ANIMATION_ROWS,
  MANIFEST_ENTRY_KINDS,
  MANIFEST_CANVAS_AFFINITIES,
  MANIFEST_SOURCE_CATALOGS,
  MANIFEST_ASSET_LICENSES,
  // Helpers
  createAssetKey,
  parseAssetKey,
  getDefaultAnimationsForRole,
  validateAssetAnimations,
  defaultUnitAtlas,
  manifestToAssetCatalog,
  parseAssetQuery,
  matchAssetQuery,
} from "./asset.js";

// ============================================================================
// Changeset & Snapshot Types
// ============================================================================

export {
  type SchemaChange,
  type ChangesetValue,
  type ChangeAuthor,
  type ChangeSummary,
  type ChangeSetDocument,
  type SnapshotDocument,
  type CategorizedRemovals,
  type PageContentReduction,
  type HistoryMeta,
  type ValidationMeta,
  type SemanticChangeKind,
  SEMANTIC_CHANGE_KINDS,
  type SemanticSchemaChange,
} from "./changeset.js";

// ============================================================================
// App Types
// ============================================================================

export {
  type GitHubLink,
  type StatsView,
  type AppSummary,
  type SaveOptions,
  type SaveResult,
  type ValidationIssue,
  type LLMErrorContext,
  type ValidationResults,
  type ValidationDocument,
} from "./app.js";

// ============================================================================
// Service Contract Types (Call-Service + Event Surface)
// ============================================================================

export {
  // Service Action Names
  type PersistActionName,
  type ServiceActionName,
  // Call-Service Contract
  type ServiceAction,
  type ServiceContract,
  // Event Contract
  type ServiceEvents,
  // Store Contract
  type StoreFilterOp,
  type StoreFilter,
  type RowPageRequest,
  type RowPage,
  type RowCompareOp,
  type RowPredicate,
  type RowOrder,
  type RowQuery,
  type RowQueryPage,
  type RowValueKind,
  type RowOperator,
  type OperatorValueKinds,
  type RowTotalMode,
  type QueryCapabilities,
  type RowIdPage,
  type RowWriteOp,
  type RowWriteOutcome,
  type RowWriteFailureMode,
  type RowWriteBatch,
  type WriteCapabilities,
  type PersistenceAdapter,
  type StoreContract,
  // Typed EventBus wrapper
  createTypedEventBus,
  // Lazy Service (Singleton Pattern)
  type LazyService,
  createLazyService,
} from "../service-types.js";

export {
  RowPredicateSchema,
  RowQuerySchema,
  RowQueryPageSchema,
  rowMatchesPredicate,
  compareByField,
  orderRows,
  DEFAULT_ROW_ORDER,
  effectiveRowOrder,
  runRowQuery,
  runRowIds,
  runRowWrite,
  runRowWriteBatch,
  resolveRowSet,
  queryUnsupportedReason,
  QueryDeclinedError,
  WriteDeclinedError,
  RowIdPageSchema,
  RowWriteOpSchema,
  RowWriteOutcomeSchema,
  RowWriteBatchSchema,
  WriteCapabilitiesSchema,
  QueryCapabilitiesSchema,
  FULL_QUERY_CAPABILITIES,
  FULL_WRITE_CAPABILITIES,
  type QueryUnsupportedReason,
  type QueryDeclinedReason,
} from "../row-query.js";

export {
  compileRowPredicate,
  parseFetchOrder,
  type PredicateCompilation,
  type PredicateCompileContext,
  type RowBindingResult,
  type RowBindingScalar,
} from "../row-predicate.js";

// ============================================================================
// IR Types (Intermediate Representation)
// ============================================================================

export {
  // Transition types
  type TransitionFrom,
  // Field types
  type ResolvedField,
  // Entity types
  type ResolvedEntity,
  type ResolvedEntityBinding,
  // Trait types
  type ResolvedTraitState,
  type ResolvedTraitEvent,
  type ResolvedTraitTransition,
  type ResolvedTraitGuard,
  type ResolvedTraitTick,
  type ResolvedTraitListener,
  type ResolvedTraitDataEntity,
  type ResolvedTraitUIBinding,
  type ResolvedTrait,
  type ResolvedTraitEmit,
  type ResolvedTraitBinding,
  // Pattern & Section types
  type ResolvedPattern,
  type ResolvedSectionEvent,
  type ResolvedSection,
  // Page types
  type ResolvedNavigation,
  type ResolvedPage,
  // IR types
  type ResolvedIR,
  // Factory functions
  createEmptyResolvedTrait,
  createEmptyResolvedPage,
  createResolvedField,
  inferTsType,
  // Type guards
  isResolvedIR,
} from "./ir.js";

// Context Extensions (declaration-merging surface for consumers)
export { type ContextExtensions } from "./context.js";

// Bus event envelope (unified across @almadar/ui and @almadar/runtime)
export {
  type EventKey,
  type EventEmit,
  type EventListen,
  type BusEvent,
  type BusEventSource,
  BusEventSourceSchema,
  type BusEventListener,
  type Unsubscribe,
  type EmittedEvent,
  EmittedEventSchema,
  // Client-effect wire grammar
  type ClientRenderUITuple,
  type ClientNavigateTuple,
  type ClientNavigateBackTuple,
  type ClientEffectTuple,
  ClientRenderUITupleSchema,
  ClientNavigateTupleSchema,
  ClientNavigateBackTupleSchema,
  ClientEffectTupleSchema,
  // Event dispatch wire — canonical = the TS runtime's implementation
  type OrbitalEventRequest,
  type OrbitalEventResponse,
  type ClientEffectByTrait,
  type TransitionRejection,
  type TransitionRejectionCode,
  type TransitionHop,
  type HopEffect,
  type HopEffectStatus,
  type ExternalInputRequest,
  type ServiceHostPorts,
  type DispatchRequestOutcome,
  type EventStreamItem,
  EventStreamItemSchema,
  OrbitalEventRequestSchema,
  OrbitalEventResponseSchema,
  LIFECYCLE_EVENTS,
  type LifecycleEvent,
  SYSTEM_UI_EVENTS,
  type SystemUiEvent,
  isSystemUiEvent,
  UNMOUNT_EVENT,
  normalizeEventKey,
  tickEventKey,
  type MountSeed,
  MountSeedSchema,
  // Register wire
  type ServerTopology,
  type OrbitalRegisterResponse,
  ServerTopologySchema,
  OrbitalRegisterResponseSchema,
  // Live broadcast wire (server → other connected clients)
  type LiveBroadcastItem,
  LiveBroadcastItemSchema,
  /** @deprecated use OrbitalEventRequest */
  type EventDispatchRequest,
  /** @deprecated use OrbitalEventRequestSchema */
  EventDispatchRequestSchema,
  /** @deprecated use OrbitalEventResponse */
  type EventDispatchResponse,
  /** @deprecated use OrbitalEventResponseSchema */
  EventDispatchResponseSchema,
} from "./bus.js";

export { dispatchVisitKey, DispatchVisits } from "./visit-key.js";
export { type DeliveryRecord, type DispatchLog, DeliveryRecordSchema, DispatchLogSchema, deliveryRecordValue } from "./bus.js";
export { DispatchMemory, dispatchScopeOf, type DispatchScope } from "./dispatch-memory.js";
export { guardHolds } from "./guard-holds.js";

// Server-side effect result — the wire shape effectResults carries
export {
  type ServerBatchSummary,
  ServerBatchSummarySchema,
  type ServerEffectResult,
  ServerEffectResultSchema,
} from "./effect-result.js";

// Verification wire types (shared by @almadar/ui's verificationRegistry
// producer and @almadar-io/verify's state-bridge consumer — hoisted
// so the window.__orbitalVerification contract can't drift).
export {
  type CheckStatus,
  type VerificationCheck,
  type EffectTrace,
  type ServerResponseTrace,
  type TransitionTrace,
  type BridgeHealth,
  type VerificationSummary,
  type TraitStateSnapshot,
  type VerificationSnapshot,
  type AssetLoadStatus,
  type EventLogEntry,
  type ActionGesture,
  type GuardEvaluation,
  type CircuitStepResult,
  type DrawableDescriptor,
  type OrbitalVerificationAPI,
  PATTERN_PROP_TYPE_ERROR_TESTID,
  TRAIT_MOUNT_ERROR_TESTID,
  EMPTY_STATE_MARKER,
  LOADING_STATE_MARKER,
  VERIFICATION_DOM_ATTRS,
  ACTION_TESTID_PREFIX,
  ACTION_OVERFLOW_TESTID,
  FORM_PATTERN,
  actionTestId,
  actionTestIdMatches,
  gestureActionTestId,
  gestureOfActionTestId,
  GESTURE_EVENT_PROPS,
  NATIVE_ID_SEPARATOR,
  nativeIds,
  splitNativeIds,
  NATIVE_ID_PREFIX,
  nativePatternId,
  nativeRowId,
  nativeFieldId,
  nativeSlotId,
} from "./verification.js";

// ============================================================================
// JSON Primitives (universal "data crossed a boundary" types)
// ============================================================================

export {
  type JsonValue,
  type JsonObject,
  type ToolArgs,
  type RuntimeValue,
  JsonValueSchema,
  toPayloadValue,
  isJsonPrimitive,
  isJsonObject,
  isJsonArray,
} from "./json.js";

// ============================================================================
// SSE Event Types (agent wire contract consumed by the public SDK)
// ============================================================================

export {
  type SSEEvent,
  type SSEEventType,
  type SSEEventBase,
  type StartEvent,
  type MessageEvent,
  type LlmCallMeta,
  type ToolCallEvent,
  type ToolResultEvent,
  type TodoUpdateEvent,
  type TodoActivityType,
  type TodoDetailEvent,
  type FileOperationEvent,
  type FileWrittenEvent,
  type SchemaUpdateEvent,
  type GenerationLogEvent,
  type SubagentEvent,
  type SubagentStartEvent,
  type SubagentProgressEvent,
  type SubagentCompleteEvent,
  type InterruptEvent,
  type ErrorEvent,
  type CancelledEvent,
  type CompleteEvent,
  type AppCreatedEvent,
  type SchemaPhaseValidatedEvent,
  type SchemaPhaseUpdateEvent,
  type OrbitalAddedEvent,
  type OrbitalSchemaCompleteEvent,
  type ProcessStartEvent,
  type ProcessCompleteEvent,
  type ProcessErrorEvent,
  type ProcessRepairEvent,
  type ProcessRepairCompleteEvent,
  type ParamsRepairEmittedEvent,
  type ChangesetRecordedEvent,
  type SnapshotCreatedEvent,
} from "./sse.js";

// ============================================================================
// Validation Errors
// ============================================================================

export {
  type ValidationError,
  type ValidationErrorCode,
  type ValidationResult,
  type KnownValidationErrorCode,
  KNOWN_VALIDATION_ERROR_CODES,
  isKnownValidationErrorCode,
  orbitalIndexOfValidationPath,
} from "./validation.js";

// ============================================================================
// Living Orbital Schema (Golden Data Structure — §VIII type system)
// ============================================================================

export {
  // Semantic annotation
  type AnnotationTier,
  type SemanticAnnotation,
  widenTier,
  // ML scalars / vectors
  type SemanticVector,
  type Probability,
  type GateState,
  // Graph vertex / edge typing
  type VertexType,
  type VertexId,
  type EdgeType,
  type EffectPayload,
  type KnobPayload,
  type VertexPayload,
  type LivingVertex,
  type LivingOrbital,
  type LivingEntity,
  type LivingTrait,
  type LivingState,
  type LivingTransition,
  type LivingPage,
  type LivingField,
  type LivingEvent,
  type LivingEffect,
  type LivingValue,
  type LivingEdge,
  // Evolution / lineage
  type EvolutionDelta,
  type LineageEntry,
  // Effect simulation
  type EffectResult,
  // The living schema contract
  type LivingOrbitalSchema,
} from "./living.js";

// ============================================================================
// Parsed AST (LLM-emit relaxed views of the canonical orbital types)
// ============================================================================

export {
  type ParsedOrbital,
  type ParsedEntity,
  type ParsedTrait,
  type ParsedTraitConfig,
  type ParsedStateMachine,
  type ParsedState,
  type ParsedEvent,
  type ParsedTransition,
  type ParsedEmitDeclaration,
  type ParsedListenDeclaration,
  type ParsedPage,
  type ParsedDomainContext,
  type ParsedDesign,
  type ValidatedOrbital,
} from "./parsed-ast.js";

// Renderable-content value types for `node`-typed fields/knobs. Type-only
// re-export (erased at runtime) — `render-ui-edit.ts` imports value helpers
// FROM this barrel, so a runtime re-export would cycle; a type re-export
// cannot.
export type { PatternNode, PatternValue } from "../render-ui-edit.js";

// Accessibility attribute vocabulary (A11yProps + its registry schema)
export * from "./a11y.js";

export {
  SKELETON_VARIANTS,
  SkeletonVariantSchema,
  SkeletonShapeSchema,
  SkeletonSpecSchema,
  SkeletonNodeSchema,
  AwaitRenderSchema,
  type SkeletonVariant,
  type SkeletonShape,
  type SkeletonSpec,
  type SkeletonNode,
  type AwaitRender,
  type AwaitingTrait,
} from "./skeleton.js";
export { SURFACE_MODES, type SurfaceMode } from "./surface.js";
export * from "./canvas-theme.js";

// Behaviors as first-class values (language trio)
export * from "./behavior-value.js";

// Generator evals as data (`orb eval`)
export * from "./eval-spec.js";

// The browser-tab host port of the `browser/tab-*` effects
export { TabHostFailure, type BrowserTabPort, type TabAskContext, type TabUrlMatcher } from "./tab-port.js";
export { ClientManifestSchema, ClientThemeSchema, parseClientManifest, type ClientManifest, type ClientTheme } from "./client-manifest.js";
export {
  MachineRowSchema,
  PayloadSlotSchema,
  PlayedStepSchema,
  type GuardVerdict,
  type MachineRow,
  type PayloadSlot,
  type PlayedEffect,
  type PlayedEffectStatus,
  type PlayedEmit,
  type PlayedGuard,
  type PlayedResult,
  type PlayedState,
  type PlayedStep,
} from "./program-machine.js";

export type { TraitDefinition, IndexedTrait, TraitIndex } from "./trait-index.js";
