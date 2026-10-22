/**
 * Compile-time-only check (gap G-CORE-001): for every hand-written Zod
 * schema paired with a hand-written TS type/interface of the same name,
 * assert the schema's declared keys are a SUPERSET of the type's keys.
 *
 * This package never derives either side from the other (`z.infer` is not
 * used anywhere in src/types/), so a schema can silently drop a field the
 * type still declares — it has happened twice (`OrbitalEntitySchema` missing
 * `id`, `OrbitalDefinitionSchema` missing `auxiliaryEntities`), both fixed
 * additively. This file is the standing prevention: `pnpm typecheck` fails
 * with the exact missing key name(s) the moment a THIRD instance lands.
 *
 * Not a runtime test — no assertions execute. `SchemaCoversType<T, S>`
 * resolves to the literal type `true` when `keyof T` is covered by
 * `keyof z.infer<S>`, or to a `{ MISSING_KEYS_ON_SCHEMA: ... }` object type
 * naming the gap otherwise — assigning `true` to that then fails to
 * typecheck, pointing straight at the offending line and the missing key(s).
 * A schema with EXTRA fields the type doesn't declare is fine (superset
 * check only, not exact-shape equality).
 *
 * Lives in `__tests__/` (not `src/`) so it never ships in `dist/`, but is
 * NOT named `*.test.ts` — vitest fails a matched file with zero test blocks
 * ("No test suite found"), and this file has none by design. `tsc --noEmit`
 * (this package's `include` is `./**\/*.ts`, so `__tests__/` is in scope)
 * is what actually enforces it.
 */
import type { z } from 'zod';

type SchemaCoversType<TType, TSchema extends z.ZodTypeAny> =
  Exclude<keyof TType, keyof z.infer<TSchema>> extends never
    ? true
    : { MISSING_KEYS_ON_SCHEMA: Exclude<keyof TType, keyof z.infer<TSchema>> };

import type { AnimationDef, AssetCatalogEntry, Camera, ManifestEntry, ScenePos, SemanticAssetRef, SoundEntry, SpriteSheetAtlas, SubTexture, TextureAtlas, Tilesheet } from '../src/types/asset.js';
import { AnimationDefSchema, AssetCatalogEntrySchema, CameraSchema, ManifestEntrySchema, ScenePosSchema, SemanticAssetRefSchema, SoundEntrySchema, SpriteSheetAtlasSchema, SubTextureSchema, TextureAtlasSchema, TilesheetSchema } from '../src/types/asset.js';
import type { BusEventSource, EmittedEvent, LiveBroadcastItem, OrbitalEventRequest, OrbitalEventResponse } from '../src/types/bus.js';
import { BusEventSourceSchema, EmittedEventSchema, LiveBroadcastItemSchema, OrbitalEventRequestSchema, OrbitalEventResponseSchema } from '../src/types/bus.js';
import type { ColorTokens, CustomPatternDefinition, DensityTokens, DesignPreferences, DomainContext, ElevationTokens, GeometryTokens, IconographyTokens, IllustrationTokens, DiagramTokens, SceneTokens, SurfaceTokens, MotionDurationPalette, MotionEasingPalette, MotionIntent, MotionIntentMap, MotionTokens, RelatedLink, SpacingScale, SuggestedGuard, ThemeDefinition, ThemeTokens, ThemeVariant, TypeIntent, TypeIntentMap, TypeScale, TypeScaleEntry, TypeScaleTokens, UserPersona, UXHints } from '../src/types/domain.js';
import { ColorTokensSchema, CustomPatternDefinitionSchema, DensityTokensSchema, DesignPreferencesSchema, DomainContextSchema, ElevationTokensSchema, GeometryTokensSchema, IconographyTokensSchema, IllustrationTokensSchema, DiagramTokensSchema, SceneTokensSchema, SurfaceTokensSchema, MotionDurationPaletteSchema, MotionEasingPaletteSchema, MotionIntentSchema, MotionIntentMapSchema, MotionTokensSchema, RelatedLinkSchema, SpacingScaleSchema, SuggestedGuardSchema, ThemeDefinitionSchema, ThemeTokensSchema, ThemeVariantSchema, TypeIntentSchema, TypeIntentMapSchema, TypeScaleSchema, TypeScaleEntrySchema, TypeScaleTokensSchema, UserPersonaSchema, UXHintsSchema } from '../src/types/domain.js';
import type { ServerBatchSummary, ServerEffectResult } from '../src/types/effect-result.js';
import { ServerBatchSummarySchema, ServerEffectResultSchema } from '../src/types/effect-result.js';
import type { OrbitalEntity } from '../src/types/entity.js';
import { OrbitalEntitySchema } from '../src/types/entity.js';
import type { FileValue, RelationConfig } from '../src/types/field.js';
import { FileValueSchema, RelationConfigSchema } from '../src/types/field.js';
import type { IdentityLedger, LedgerEntry } from '../src/types/identity.js';
import { IdentityLedgerSchema, LedgerEntrySchema } from '../src/types/identity.js';
import type { InteractionModel } from '../src/types/interaction-model.js';
import { InteractionModelSchema } from '../src/types/interaction-model.js';
import type { ComputedEventContract, ComputedEventListener, EventListener, EventSource, OrbitalDefinition, OrbitalRefObject, PageRefObject, UseDeclaration } from '../src/types/orbital.js';
import { ComputedEventContractSchema, ComputedEventListenerSchema, EventListenerSchema, EventSourceSchema, OrbitalDefinitionSchema, OrbitalRefObjectSchema, PageRefObjectSchema, UseDeclarationSchema } from '../src/types/orbital.js';
import type { OrbitalPage, PageTraitRef } from '../src/types/page.js';
import { OrbitalPageSchema, PageTraitRefSchema } from '../src/types/page.js';
import type { ConfigProvenanceRecord, OrbitalSchema, SchemaMetadata } from '../src/types/schema.js';
import { ConfigProvenanceRecordSchema, OrbitalSchemaSchema, SchemaMetadataSchema } from '../src/types/schema.js';
import type { McpServiceDef, RestAuthConfig, RestServiceDef, ServiceRefObject, SocketEvents, SocketServiceDef } from '../src/types/service.js';
import { McpServiceDefSchema, RestAuthConfigSchema, RestServiceDefSchema, ServiceRefObjectSchema, SocketEventsSchema, SocketServiceDefSchema } from '../src/types/service.js';
import type { Event, Guard, PayloadField, PayloadTypeWhen, State, StateMachine, Transition } from '../src/types/state-machine.js';
import { EventSchema, GuardSchema, PayloadFieldSchema, PayloadTypeWhenSchema, StateSchema, StateMachineSchema, TransitionSchema } from '../src/types/state-machine.js';
import type { ConfigFieldDeclaration, EffectUse, EntityFieldContract, EventPayloadField, RequiredField, SourceBehaviorMetadata, Trait, TraitDataEntity, TraitEntityField, TraitEventContract, TraitEventListener, TraitTick, TraitTypeParamDef } from '../src/types/trait.js';
import { ConfigFieldDeclarationSchema, EffectUseSchema, EntityFieldContractSchema, EventPayloadFieldSchema, RequiredFieldSchema, SourceBehaviorMetadataSchema, TraitSchema, TraitDataEntitySchema, TraitEntityFieldSchema, TraitEventContractSchema, TraitEventListenerSchema, TraitTickSchema, TraitTypeParamDefSchema } from '../src/types/trait.js';

// ─── asset.ts ───
const _checkAnimationDef: SchemaCoversType<AnimationDef, typeof AnimationDefSchema> = true;
void _checkAnimationDef;
const _checkAssetCatalogEntry: SchemaCoversType<AssetCatalogEntry, typeof AssetCatalogEntrySchema> = true;
void _checkAssetCatalogEntry;
const _checkCamera: SchemaCoversType<Camera, typeof CameraSchema> = true;
void _checkCamera;
const _checkManifestEntry: SchemaCoversType<ManifestEntry, typeof ManifestEntrySchema> = true;
void _checkManifestEntry;
const _checkScenePos: SchemaCoversType<ScenePos, typeof ScenePosSchema> = true;
void _checkScenePos;
const _checkSemanticAssetRef: SchemaCoversType<SemanticAssetRef, typeof SemanticAssetRefSchema> = true;
void _checkSemanticAssetRef;
const _checkSoundEntry: SchemaCoversType<SoundEntry, typeof SoundEntrySchema> = true;
void _checkSoundEntry;
const _checkSpriteSheetAtlas: SchemaCoversType<SpriteSheetAtlas, typeof SpriteSheetAtlasSchema> = true;
void _checkSpriteSheetAtlas;
const _checkSubTexture: SchemaCoversType<SubTexture, typeof SubTextureSchema> = true;
void _checkSubTexture;
const _checkTextureAtlas: SchemaCoversType<TextureAtlas, typeof TextureAtlasSchema> = true;
void _checkTextureAtlas;
const _checkTilesheet: SchemaCoversType<Tilesheet, typeof TilesheetSchema> = true;
void _checkTilesheet;

// ─── bus.ts ───
const _checkBusEventSource: SchemaCoversType<BusEventSource, typeof BusEventSourceSchema> = true;
void _checkBusEventSource;
const _checkEmittedEvent: SchemaCoversType<EmittedEvent, typeof EmittedEventSchema> = true;
void _checkEmittedEvent;
const _checkLiveBroadcastItem: SchemaCoversType<LiveBroadcastItem, typeof LiveBroadcastItemSchema> = true;
void _checkLiveBroadcastItem;
const _checkOrbitalEventRequest: SchemaCoversType<OrbitalEventRequest, typeof OrbitalEventRequestSchema> = true;
void _checkOrbitalEventRequest;
const _checkOrbitalEventResponse: SchemaCoversType<OrbitalEventResponse, typeof OrbitalEventResponseSchema> = true;
void _checkOrbitalEventResponse;

// ─── domain.ts ───
const _checkColorTokens: SchemaCoversType<ColorTokens, typeof ColorTokensSchema> = true;
void _checkColorTokens;
const _checkCustomPatternDefinition: SchemaCoversType<CustomPatternDefinition, typeof CustomPatternDefinitionSchema> = true;
void _checkCustomPatternDefinition;
const _checkDensityTokens: SchemaCoversType<DensityTokens, typeof DensityTokensSchema> = true;
void _checkDensityTokens;
const _checkDesignPreferences: SchemaCoversType<DesignPreferences, typeof DesignPreferencesSchema> = true;
void _checkDesignPreferences;
const _checkDomainContext: SchemaCoversType<DomainContext, typeof DomainContextSchema> = true;
void _checkDomainContext;
const _checkElevationTokens: SchemaCoversType<ElevationTokens, typeof ElevationTokensSchema> = true;
void _checkElevationTokens;
const _checkGeometryTokens: SchemaCoversType<GeometryTokens, typeof GeometryTokensSchema> = true;
void _checkGeometryTokens;
const _checkIconographyTokens: SchemaCoversType<IconographyTokens, typeof IconographyTokensSchema> = true;
void _checkIconographyTokens;
const _checkIllustrationTokens: SchemaCoversType<IllustrationTokens, typeof IllustrationTokensSchema> = true;
void _checkIllustrationTokens;
const _checkDiagramTokens: SchemaCoversType<DiagramTokens, typeof DiagramTokensSchema> = true;
void _checkDiagramTokens;
const _checkSceneTokens: SchemaCoversType<SceneTokens, typeof SceneTokensSchema> = true;
void _checkSceneTokens;
const _checkSurfaceTokens: SchemaCoversType<SurfaceTokens, typeof SurfaceTokensSchema> = true;
void _checkSurfaceTokens;
const _checkMotionDurationPalette: SchemaCoversType<MotionDurationPalette, typeof MotionDurationPaletteSchema> = true;
void _checkMotionDurationPalette;
const _checkMotionEasingPalette: SchemaCoversType<MotionEasingPalette, typeof MotionEasingPaletteSchema> = true;
void _checkMotionEasingPalette;
const _checkMotionIntent: SchemaCoversType<MotionIntent, typeof MotionIntentSchema> = true;
void _checkMotionIntent;
const _checkMotionIntentMap: SchemaCoversType<MotionIntentMap, typeof MotionIntentMapSchema> = true;
void _checkMotionIntentMap;
const _checkMotionTokens: SchemaCoversType<MotionTokens, typeof MotionTokensSchema> = true;
void _checkMotionTokens;
const _checkRelatedLink: SchemaCoversType<RelatedLink, typeof RelatedLinkSchema> = true;
void _checkRelatedLink;
const _checkSpacingScale: SchemaCoversType<SpacingScale, typeof SpacingScaleSchema> = true;
void _checkSpacingScale;
const _checkSuggestedGuard: SchemaCoversType<SuggestedGuard, typeof SuggestedGuardSchema> = true;
void _checkSuggestedGuard;
const _checkThemeDefinition: SchemaCoversType<ThemeDefinition, typeof ThemeDefinitionSchema> = true;
void _checkThemeDefinition;
const _checkThemeTokens: SchemaCoversType<ThemeTokens, typeof ThemeTokensSchema> = true;
void _checkThemeTokens;
const _checkThemeVariant: SchemaCoversType<ThemeVariant, typeof ThemeVariantSchema> = true;
void _checkThemeVariant;
const _checkTypeIntent: SchemaCoversType<TypeIntent, typeof TypeIntentSchema> = true;
void _checkTypeIntent;
const _checkTypeIntentMap: SchemaCoversType<TypeIntentMap, typeof TypeIntentMapSchema> = true;
void _checkTypeIntentMap;
const _checkTypeScale: SchemaCoversType<TypeScale, typeof TypeScaleSchema> = true;
void _checkTypeScale;
const _checkTypeScaleEntry: SchemaCoversType<TypeScaleEntry, typeof TypeScaleEntrySchema> = true;
void _checkTypeScaleEntry;
const _checkTypeScaleTokens: SchemaCoversType<TypeScaleTokens, typeof TypeScaleTokensSchema> = true;
void _checkTypeScaleTokens;
const _checkUserPersona: SchemaCoversType<UserPersona, typeof UserPersonaSchema> = true;
void _checkUserPersona;
const _checkUXHints: SchemaCoversType<UXHints, typeof UXHintsSchema> = true;
void _checkUXHints;

// ─── effect-result.ts ───
const _checkServerBatchSummary: SchemaCoversType<ServerBatchSummary, typeof ServerBatchSummarySchema> = true;
void _checkServerBatchSummary;
const _checkServerEffectResult: SchemaCoversType<ServerEffectResult, typeof ServerEffectResultSchema> = true;
void _checkServerEffectResult;

// ─── entity.ts ───
const _checkOrbitalEntity: SchemaCoversType<OrbitalEntity, typeof OrbitalEntitySchema> = true;
void _checkOrbitalEntity;

// ─── field.ts ───
const _checkFileValue: SchemaCoversType<FileValue, typeof FileValueSchema> = true;
void _checkFileValue;
const _checkRelationConfig: SchemaCoversType<RelationConfig, typeof RelationConfigSchema> = true;
void _checkRelationConfig;

// ─── identity.ts ───
const _checkIdentityLedger: SchemaCoversType<IdentityLedger, typeof IdentityLedgerSchema> = true;
void _checkIdentityLedger;
const _checkLedgerEntry: SchemaCoversType<LedgerEntry, typeof LedgerEntrySchema> = true;
void _checkLedgerEntry;

// ─── interaction-model.ts ───
const _checkInteractionModel: SchemaCoversType<InteractionModel, typeof InteractionModelSchema> = true;
void _checkInteractionModel;

// ─── orbital.ts ───
const _checkComputedEventContract: SchemaCoversType<ComputedEventContract, typeof ComputedEventContractSchema> = true;
void _checkComputedEventContract;
const _checkComputedEventListener: SchemaCoversType<ComputedEventListener, typeof ComputedEventListenerSchema> = true;
void _checkComputedEventListener;
const _checkEventListener: SchemaCoversType<EventListener, typeof EventListenerSchema> = true;
void _checkEventListener;
const _checkEventSource: SchemaCoversType<EventSource, typeof EventSourceSchema> = true;
void _checkEventSource;
const _checkOrbitalDefinition: SchemaCoversType<OrbitalDefinition, typeof OrbitalDefinitionSchema> = true;
void _checkOrbitalDefinition;
const _checkOrbitalRefObject: SchemaCoversType<OrbitalRefObject, typeof OrbitalRefObjectSchema> = true;
void _checkOrbitalRefObject;
const _checkPageRefObject: SchemaCoversType<PageRefObject, typeof PageRefObjectSchema> = true;
void _checkPageRefObject;
const _checkUseDeclaration: SchemaCoversType<UseDeclaration, typeof UseDeclarationSchema> = true;
void _checkUseDeclaration;

// ─── page.ts ───
const _checkOrbitalPage: SchemaCoversType<OrbitalPage, typeof OrbitalPageSchema> = true;
void _checkOrbitalPage;
const _checkPageTraitRef: SchemaCoversType<PageTraitRef, typeof PageTraitRefSchema> = true;
void _checkPageTraitRef;

// ─── schema.ts ───
const _checkConfigProvenanceRecord: SchemaCoversType<ConfigProvenanceRecord, typeof ConfigProvenanceRecordSchema> = true;
void _checkConfigProvenanceRecord;
const _checkOrbitalSchema: SchemaCoversType<OrbitalSchema, typeof OrbitalSchemaSchema> = true;
void _checkOrbitalSchema;
const _checkSchemaMetadata: SchemaCoversType<SchemaMetadata, typeof SchemaMetadataSchema> = true;
void _checkSchemaMetadata;

// ─── service.ts ───
const _checkMcpServiceDef: SchemaCoversType<McpServiceDef, typeof McpServiceDefSchema> = true;
void _checkMcpServiceDef;
const _checkRestAuthConfig: SchemaCoversType<RestAuthConfig, typeof RestAuthConfigSchema> = true;
void _checkRestAuthConfig;
const _checkRestServiceDef: SchemaCoversType<RestServiceDef, typeof RestServiceDefSchema> = true;
void _checkRestServiceDef;
const _checkServiceRefObject: SchemaCoversType<ServiceRefObject, typeof ServiceRefObjectSchema> = true;
void _checkServiceRefObject;
const _checkSocketEvents: SchemaCoversType<SocketEvents, typeof SocketEventsSchema> = true;
void _checkSocketEvents;
const _checkSocketServiceDef: SchemaCoversType<SocketServiceDef, typeof SocketServiceDefSchema> = true;
void _checkSocketServiceDef;

// ─── state-machine.ts ───
const _checkEvent: SchemaCoversType<Event, typeof EventSchema> = true;
void _checkEvent;
const _checkGuard: SchemaCoversType<Guard, typeof GuardSchema> = true;
void _checkGuard;
const _checkPayloadField: SchemaCoversType<PayloadField, typeof PayloadFieldSchema> = true;
void _checkPayloadField;
const _checkPayloadTypeWhen: SchemaCoversType<PayloadTypeWhen, typeof PayloadTypeWhenSchema> = true;
void _checkPayloadTypeWhen;
const _checkState: SchemaCoversType<State, typeof StateSchema> = true;
void _checkState;
const _checkStateMachine: SchemaCoversType<StateMachine, typeof StateMachineSchema> = true;
void _checkStateMachine;
const _checkTransition: SchemaCoversType<Transition, typeof TransitionSchema> = true;
void _checkTransition;

// ─── trait.ts ───
const _checkConfigFieldDeclaration: SchemaCoversType<ConfigFieldDeclaration, typeof ConfigFieldDeclarationSchema> = true;
void _checkConfigFieldDeclaration;
const _checkEffectUse: SchemaCoversType<EffectUse, typeof EffectUseSchema> = true;
void _checkEffectUse;
const _checkEntityFieldContract: SchemaCoversType<EntityFieldContract, typeof EntityFieldContractSchema> = true;
void _checkEntityFieldContract;
const _checkEventPayloadField: SchemaCoversType<EventPayloadField, typeof EventPayloadFieldSchema> = true;
void _checkEventPayloadField;
const _checkRequiredField: SchemaCoversType<RequiredField, typeof RequiredFieldSchema> = true;
void _checkRequiredField;
const _checkSourceBehaviorMetadata: SchemaCoversType<SourceBehaviorMetadata, typeof SourceBehaviorMetadataSchema> = true;
void _checkSourceBehaviorMetadata;
const _checkTrait: SchemaCoversType<Trait, typeof TraitSchema> = true;
void _checkTrait;
const _checkTraitDataEntity: SchemaCoversType<TraitDataEntity, typeof TraitDataEntitySchema> = true;
void _checkTraitDataEntity;
const _checkTraitEntityField: SchemaCoversType<TraitEntityField, typeof TraitEntityFieldSchema> = true;
void _checkTraitEntityField;
const _checkTraitEventContract: SchemaCoversType<TraitEventContract, typeof TraitEventContractSchema> = true;
void _checkTraitEventContract;
const _checkTraitEventListener: SchemaCoversType<TraitEventListener, typeof TraitEventListenerSchema> = true;
void _checkTraitEventListener;
const _checkTraitTick: SchemaCoversType<TraitTick, typeof TraitTickSchema> = true;
void _checkTraitTick;
const _checkTraitTypeParamDef: SchemaCoversType<TraitTypeParamDef, typeof TraitTypeParamDefSchema> = true;
void _checkTraitTypeParamDef;

