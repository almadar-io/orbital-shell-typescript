/**
 * Providers barrel export
 *
 * Unified providers for Orbital applications.
 * Use OrbitalProvider for most cases - it combines all required providers.
 */

// Main unified provider
export { OrbitalProvider, type OrbitalProviderProps } from './OrbitalProvider';

// Re-export UIThemeDefinition for generated theme configs.
// (The ThemeContext/UISlotContext VALUE API is owned by @almadar/ui/context —
// the tsup dedupe plugins make that subpath the single concrete runtime home,
// so re-exporting those values here would round-trip through context and create
// a self-referential re-export. Only the pure type is safe to surface.)


// Orbital theme provider
export { OrbitalThemeProvider, type OrbitalThemeProviderProps } from './OrbitalThemeProvider';

// Design theme provider
export { DesignThemeProvider, useDesignTheme } from './DesignThemeContext';

// Current page path provider
export {
  CurrentPagePathProvider,
  CurrentPagePathContext,
  useCurrentPagePath,
  type CurrentPagePathProviderProps,
} from './CurrentPagePathContext';

export {
  RenderSlotProvider,
  useRenderSlot,
  type RenderSlotProviderProps,
} from './RenderSlotContext';

// User provider
export {
  UserProvider,
  UserContext,
  useUser,
  useHasRole,
  useHasPermission,
  useUserForEvaluation,
  ANONYMOUS_USER,
  type UserData,
  type UserContextValue,
  type UserProviderProps,
} from './UserContext';

// Editor focus (the keyboard router reads which editor holds focus)
export { EditorFocusProvider, useEditorFocus, type EditorFocus } from './EditorFocusContext';

// Entity schema provider (its hooks are pulled into the providers chunk via
// OrbitalProvider → UISlotRenderer, and the dedupe redirect routes every other
// chunk's import of them through this barrel, so they must be re-exported here).
export {
  EntitySchemaProvider,
  useEntitySchema,
  useEntitySchemaOptional,
  type EntitySchemaContextValue,
  type EntitySchemaProviderProps,
} from './EntitySchemaContext';

// Navigation, server bridge and trait providers are top-level providers/*
// modules: dedupeProvidersPlugin redirects every other chunk's import of them
// to @almadar/ui/providers, so the barrel must surface their full public API or
// those redirected imports dangle (renderer/runtime/avl chunks consume these).

export {
  ServerBridgeProvider,
  useServerBridge,
  type ServerBridgeContextValue,
  type ServerBridgeTransport,
  type ServerBridgeProviderProps,
  type AccessTokenProvider,
} from './ServerBridge';

export {
  TraitProvider,
  TraitContext,
  useTraitContext,
  useTrait,
  type TraitInstance,
  type TraitContextValue,
  type TraitProviderProps,
} from './TraitProvider';

// Individual providers (for advanced use cases)



export { SelectionProvider, SelectionContext, useSelection, useSelectionOptional } from './SelectionProvider';
export type { SelectionContextType } from './SelectionProvider';
export { EntityBindingContext, useEntityBindingSnapshot } from './EntityBindingContext';
export type { EntityBindingSource } from './EntityBindingContext';
export { KernelEngineContext, KernelEngineProvider, KernelLoaderMissingError, useKernelEngine } from './KernelEngineContext';
export type { KernelEngineValue, KernelEngineProviderProps } from './KernelEngineContext';
export type { KernelLoader, KernelModule, KernelInstance } from '../lib/kernel-wire';
export { AwaitingSkeletonContext, useAwaitingSkeleton } from './AwaitingSkeletonContext';
export type { AwaitingSkeletonSource } from './AwaitingSkeletonContext';

// G13 Phase 3 (2026-04-24): the FetchedDataProvider family has been
// removed. It was never mounted in any real provider tree, so consumers
// that called `useFetchedDataContext()` always got `null`. Pattern
// components now receive pre-resolved entity data via the `entity` prop
// (bound from the state machine's `@payload.data` emission); ticks take
// their entity map as a hook argument directly.

// Verification provider
export { VerificationProvider, mapServerEffectResults } from './VerificationProvider';
export type { VerificationProviderProps } from './VerificationProvider';

export {
  GameAudioProvider,
  GameAudioContext,
  useGameAudioContext,
  useGameAudioContextOptional,
} from './GameAudioProvider';
export type {
  GameAudioProviderProps,
  GameAudioContextValue,
} from './GameAudioProvider';

export { PageAccessHost } from './PageAccessHost';
export type { PageAccessHostProps } from './PageAccessHost';




export {
  ArbitraryClassCompilerProvider,
  useArbitraryClassStyles,
  resetArbitraryClassStyles,
  ARBITRARY_CLASS_STYLE_ID,
} from './ArbitraryClassCompiler';
export type { ArbitraryClassCompiler, ArbitraryClassCompilerProviderProps } from './ArbitraryClassCompiler';

export { Avl3DContext, useAvl3DConfig, useAvl3DPalette, type Avl3DModelOverrides, type Avl3DConfig } from './avl-3d-context';

// Note: EventBusContextType is exported from hooks/event-bus-types to avoid duplicate exports

export { RowSetResolverProvider, useRowSetResolverHandle, useRowSetResolver } from './RowSetResolverContext';
