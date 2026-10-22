import servicesRegistry from './services-registry.json' with { type: 'json' };
import componentMapping from './component-mapping.json' with { type: 'json' };
import eventContracts from './event-contracts.json' with { type: 'json' };

// Export both registries
export { servicesRegistry, componentMapping, eventContracts };
export { patternsRegistry, registry, PATTERN_REGISTRY, getPatternDefinition } from './definitions.js';

// Export pattern types for compile-time validation
export {
  PatternType,
  PatternPropsMap,
  PatternProps,
  PatternConfig,
  AnyPatternConfig,
  PATTERN_TYPES,
  isValidPatternType,
} from './pattern-types.js';

// Content-grade vs chrome classification (single owner — lint/slot consumers)
export {
  RenderUiPayload,
  isContentBodyPattern,
  isContentBodyPatternType,
  isMainSlotRenderUi,
} from './content-grade.js';

// Self-overlay pattern types (single owner — lint/slot consumers)
export { SELF_OVERLAY_PATTERN_TYPES } from './self-overlay.js';

export const SERVICES_REGISTRY = servicesRegistry;

const RUNTIMES_BY_SERVICE: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries(servicesRegistry.services).map(([name, entry]) => [name, entry.runtimes]),
);

/**
 * Whether a call to `service` runs in the browser: it declares the browser
 * runtime and no server one. Twin of orbital-core `effects::is_browser_only`.
 */
export function isBrowserOnlyService(service: string): boolean {
  const runtimes = RUNTIMES_BY_SERVICE.get(service) ?? [];
  return runtimes.includes('browser') && !runtimes.includes('node');
}
export const COMPONENT_MAPPING = componentMapping;
export const EVENT_CONTRACTS = eventContracts;

import type { PatternPropDef, PropKind } from './types.js';
export { PROP_KINDS } from './types.js';

export type {
  PatternPropDef,
  PropKind,
  PatternPropTypeSchema,
  PatternPayloadField,
  PatternCallbackArg,
} from './types.js';

// Canonical emit-payload shapes dispatched by framework data patterns.
// Pattern-level contracts live alongside the pattern registry; the
// framework-level primitives (EventPayloadValue, FieldValue) stay in
// @almadar/core.
export type {
  ItemActionPayload,
  SelectionChangePayload,
  LoadMoreRequestPayload,
  EmojiPickPayload,
  FormSubmitPayload,
} from './payloads.js';

export type PatternEntry = {
  type: string;
  category: string;
  /** Atomic-design tier of the mapped component: 'atoms' | 'molecules' | 'organisms' | 'templates'. */
  tier?: string;
  /** Component family from the @almadar/ui family-first layout: 'core' | 'game' | 'marketing' | 'avl'. */
  family?: string;
  description?: string;
  suggestedFor?: string[];
  typicalSize?: string;
  propsSchema?: Record<string, PatternPropDef>;
  entityAware?: boolean;
  /** True when the pattern is a neutral DRAWABLE — its props are grounded in core
   *  `ScenePos`. Set by pattern-sync from the `ScenePos` type identity (not a
   *  name/signal); gates what may compose under a draw-host canvas's `children`. */
  drawable?: boolean;
  /** True when the pattern is a canvas DRAW-HOST — it declares a slot of drawables
   *  (`drawables: DrawableNode[]`). Set by pattern-sync from the `DrawableNode` type
   *  identity (not a name/signal); UISlotRenderer routes the host's authored
   *  `children` into its `drawables` prop (painted) instead of DOM-wrapping them. */
  drawHost?: boolean;
  /** Declared fields-consumption contract from the component's
   *  `@fieldsContract` JSDoc tag: `form` = editable SchemaFields (schema
   *  enrichment + relationsData), `display` = read-only display fields
   *  ({key, header} + typed meta). THE capability every enrichment consumer
   *  keys on — never a hardcoded pattern-name list. */
  fieldsContract?: 'form' | 'display';
  /** Narrowest rendered width (px) the component stays usable at, from its
   *  `@minWidth` JSDoc tag. The layout check reports narrower instances. */
  minUsableWidth?: number;
};

export type PatternsRegistry = {
  version?: string;
  exportedAt?: string;
  patterns: Record<string, PatternEntry>;
  categories?: string[];
};

type ComponentMappingEntry = {
  component: string;
  importPath: string;
  category: string;
};

type ComponentMapping = {
  version?: string;
  exportedAt?: string;
  mappings: Record<string, ComponentMappingEntry>;
};

export function getComponentForPattern(patternType: string): string | null {
  const mapping = componentMapping as ComponentMapping;
  return mapping.mappings?.[patternType]?.component ?? null;
}

export {
  getPatternRuntimeDefinition,
  isEntityAwarePattern,
  eventKeyPropsOf,
  isValueInputPattern,
  eventListPropsOf,
  getPatternFieldsContract,
  getPatternMinUsableWidths,
  isDrawablePattern,
  isDrawHostPattern,
} from './runtime-contract.js';


// Export prompt helpers for @almadar/skills
export {
  getPatternsGroupedByCategory,
  getPatternPropsCompact,
  getPatternActionsRef,
  generatePatternDescription,
  getAllPatternTypes,
  getPatternMetadata,
  getOrbAllowedPatterns,
  getOrbAllowedPatternsCompact,
  getOrbAllowedPatternsSlim,
  getOrbAllowedPatternsFiltered,
} from './helpers/prompt-helpers.js';

export {
  collectRenderUiPatternTypes,
  renderUiPatternTypesOf,
  renderUiEntriesOf,
  type RenderUiEntry,
} from './helpers/render-ui-pattern-types.js';

// Export pattern recommender for @almadar/agent design tool
export {
  recommendPatterns,
  buildRecommendationContext,
  formatRecommendationsForPrompt,
  type RecommendationContext,
  type PatternRecommendation,
} from './helpers/pattern-recommender.js';

// Export pattern-swap shape gate (contextual edit: deterministic compatibility)
export {
  findCompatiblePatterns,
  getEntityCardinality,
  getEmittedEvents,
  type PatternSwapGate,
} from './helpers/pattern-swap.js';
