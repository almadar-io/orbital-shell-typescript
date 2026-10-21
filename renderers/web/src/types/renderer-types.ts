/**
 * Shared Renderer Types
 *
 * Type definitions used by both Builder and compiled shells for
 * the dual execution model. These types define the contract between
 * server and client for effect execution.
 *
 * @packageDocumentation
 */

import type { EntityRow, FieldValue, UISlot, PatternConfig } from '@almadar/core';

// ============================================================================
// Client Effect Types
// ============================================================================

/**
 * A client effect is a tuple where the first element is the effect type
 * and the remaining elements are the arguments.
 *
 * @example
 * ['render-ui', 'main', { type: 'entity-table', ... }]
 * ['navigate', '/tasks/123']
 * ['emit', 'TASK_CREATED', { id: '123' }]
 */
export type { UISlot, PatternConfig };

export type ClientEffect =
  | ['render-ui', string, PatternConfig | null]
  | ['navigate', string, Record<string, FieldValue>?]
  | ['emit', string, FieldValue?];

// ============================================================================
// Pattern Types
// ============================================================================

/**
 * Resolved pattern with component information from component-mapping.json
 */
export interface MappedPattern {
  /** Component name (e.g., 'DataTable') */
  component: string;
  /** Import path for the component */
  importPath: string;
  /** Pattern category (e.g., 'display', 'form') */
  category: string;
  /** Validated and normalized props */
  validatedProps: Record<string, FieldValue>;
}

// ============================================================================
// Event Response Types
// ============================================================================

/**
 * Response from server after processing an event.
 * This is the unified response format for both Builder and compiled shells.
 */
export interface EventResponse {
  /** Whether the event was processed successfully */
  success: boolean;
  /** New state after transition (if transition occurred) */
  newState?: string;
  /** Data fetched by server effects (e.g., { Task: [...] }) */
  data?: Record<string, EntityRow[]>;
  /** Client effects to execute (render-ui, navigate, emit) */
  clientEffects?: ClientEffect[];
  /** Results of individual effect executions (for debugging) */
  effectResults?: Array<{
    effect: string;
    success: boolean;
    data?: FieldValue;
    error?: string;
  }>;
  /** Error message if success is false */
  error?: string;
}

// ============================================================================
// Executor Configuration Types
// ============================================================================

/**
 * Configuration for the client effect executor.
 * Provides implementations for each effect type.
 */
export interface ClientEffectExecutorConfig {
  /**
   * Render a pattern to a slot.
   * Called for 'render-ui' effects.
   */
  renderToSlot: (slot: string, pattern: PatternConfig | null) => void;

  /**
   * Navigate to a route.
   * Called for 'navigate' effects.
   */
  navigate: (path: string, params?: Record<string, FieldValue>) => void;

  /**
   * Emit an event to the event bus.
   * Called for 'emit' effects.
   */
  eventBus: {
    emit: (event: string, payload?: FieldValue) => void;
  };

  /**
   * Optional: Data from server response for render-ui.
   * Components can use this to access fetched entity data.
   */
  data?: Record<string, EntityRow[]>;

  /**
   * Optional: Callback when all effects have been executed.
   */
  onComplete?: () => void;
}

// ============================================================================
// Slot Types (re-exported from useUISlots for convenience)
// ============================================================================

/**
 * Slot type classification
 */
export type SlotType = 'inline' | 'portal';

/**
 * Definition of a slot including its rendering behavior
 */
export interface SlotDefinition {
  /** Slot name */
  name: UISlot;
  /** Whether to render inline or via portal */
  type: SlotType;
  /** For portal slots: where to render (default: document.body) */
  portalTarget?: string;
  /** Z-index for portal slots */
  zIndex?: number;
  /**
   * A notification surface (toast): an embedded trait's render here shows in
   * the slot itself, never as its host frame's content. Every other slot's
   * render of an embedded trait IS its frame content.
   */
  notification?: boolean;
}

// ============================================================================
// Data Resolution Types
// ============================================================================

/**
 * Context for resolving entity data.
 * Supports multiple data sources with priority.
 */
export interface DataContext {
  /** Server-provided data (highest priority) */
  fetchedData?: Record<string, EntityRow[]>;
  /** In-memory mock data (for Builder preview) */
  entityStore?: {
    getRecords: (entityName: string) => EntityRow[];
  };
  /** Query singleton for filtering */
  querySingleton?: {
    getFilters: (queryRef: string) => Record<string, FieldValue>;
  };
}

/**
 * Result of data resolution
 */
export interface DataResolution {
  /** Resolved data array */
  data: EntityRow[];
  /** Whether data is still loading */
  loading: boolean;
  /** Error if resolution failed */
  error?: Error;
}
