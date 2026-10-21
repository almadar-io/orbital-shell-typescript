/**
 * Shared Renderer Module
 *
 * Provides unified rendering logic for both Builder preview and compiled shells.
 * This is the core of the runtime unification - both systems use this same code.
 *
 * Key components:
 * - Types: Shared type definitions for effects, patterns, responses
 * - Pattern Resolver: Pattern → Component resolution
 * - Client Effect Executor: Execute clientEffects from server
 * - useClientEffects: React hook for effect execution
 * - Data Resolver: Entity data resolution with filtering
 * - Slot Definitions: Inline vs portal slot configuration
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Effect types
  ClientEffect,
  ClientEffectExecutorConfig,

  // Pattern types
  PatternConfig,
  MappedPattern,

  // Response types
  EventResponse,

  // Slot types
  UISlot,
  SlotType,
  SlotDefinition,

  // Data types
  DataContext,
  DataResolution,
} from '../types/renderer-types';

// ============================================================================
// Pattern Resolution
// ============================================================================

export {
  resolvePattern,
  isKnownPattern,
  getKnownPatterns,
  getPatternsByCategory,
  getPatternMapping,
  getPatternDefinition,
  initializePatternResolver,
  setComponentMapping,
  setPatternRegistry,
} from '../lib/pattern-resolver';

// ============================================================================
// Client Effect Execution
// ============================================================================

export {
  executeClientEffects,
  parseClientEffect,
  parseClientEffects,
  getRenderUIEffects,
} from '../lib/client-effect-executor';

// ============================================================================
// React Hooks
// ============================================================================

export {
  useClientEffects,
  useClientEffectConfig,
  useClientEffectConfigOptional,
  ClientEffectConfigProvider,
  ClientEffectConfigContext,
} from '../hooks/useClientEffects';

export type {
  UseClientEffectsOptions,
  UseClientEffectsResult,
} from '../hooks/useClientEffects';

// ============================================================================
// Data Resolution
// ============================================================================

export {
  resolveEntityData,
  resolveEntityDataWithQuery,
  resolveEntityById,
  hasEntities,
} from '../lib/data-resolver';

// ============================================================================
// Slot Definitions
// ============================================================================

export {
  SLOT_DEFINITIONS,
  getSlotDefinition,
  isPortalSlot,
  getInlineSlots,
  ALL_SLOTS,
} from '../lib/slot-definitions';

// ============================================================================
// Offline Executor
// ============================================================================

export {
  OfflineExecutor,
  createOfflineExecutor,
  useOfflineExecutor,
} from '../lib/offline-executor';

export type {
  PendingSyncEffect,
  OfflineExecutorConfig,
  OfflineExecutorState,
  UseOfflineExecutorOptions,
  UseOfflineExecutorResult,
} from '../lib/offline-executor';

// ============================================================================
// Schema-Driven Navigation
// ============================================================================




// ============================================================================
// Initialization
// ============================================================================

export { initializePatterns } from '../lib/init';
