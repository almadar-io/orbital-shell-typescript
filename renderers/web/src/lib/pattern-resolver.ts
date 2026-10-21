/**
 * Pattern Resolver
 *
 * Resolves pattern configurations to component information.
 * Uses the central pattern registry and component mapping from orbital-shared/patterns/.
 *
 * This is the shared logic used by both Builder's PatternRenderer and
 * the compiled shell's UISlotRenderer.
 *
 * @packageDocumentation
 */

import type { FieldValue } from '@almadar/core';
import type { PatternPropDef, AnyPatternConfig } from '@almadar/core/patterns';
import type { PatternConfig, MappedPattern } from '../types/renderer-types';
import { createLogger } from '@almadar/logger';

const log = createLogger('almadar:ui:pattern-resolver');

// ============================================================================
// Component Mapping (imported from @almadar/core/patterns)
// ============================================================================

/**
 * Component mapping entry from component-mapping.json
 */
interface ComponentMappingEntry {
  component: string;
  importPath: string;
  category: string;
  deprecated?: boolean;
  replacedBy?: string;
}

/**
 * Pattern definition from registry.json
 */
interface PatternDefinition {
  type: string;
  category: string;
  description: string;
  propsSchema?: Record<string, PatternPropDef>;
}

// These will be populated by the sync process or at runtime
let componentMapping: Record<string, ComponentMappingEntry> = {};
let patternRegistry: Record<string, PatternDefinition> = {};

/**
 * Initialize the pattern resolver with mappings.
 * Called at app startup with data from JSON files.
 */
export function initializePatternResolver(config: {
  componentMapping: Record<string, ComponentMappingEntry>;
  patternRegistry: Record<string, PatternDefinition>;
}): void {
  componentMapping = config.componentMapping;
  patternRegistry = config.patternRegistry;
}

/**
 * Set component mapping (alternative to full initialization).
 */
export function setComponentMapping(
  mapping: Record<string, ComponentMappingEntry>
): void {
  componentMapping = mapping;
}

/**
 * Set pattern registry (alternative to full initialization).
 */
export function setPatternRegistry(
  registry: Record<string, PatternDefinition>
): void {
  patternRegistry = registry;
}

// ============================================================================
// Pattern Resolution
// ============================================================================

/**
 * Resolve a pattern configuration to component information.
 *
 * @param config - Pattern configuration from render-ui effect
 * @returns Resolved pattern with component name, import path, and validated props
 * @throws Error if pattern type is unknown
 *
 * @example
 * ```typescript
 * const resolved = resolvePattern({
 *   type: 'entity-table',
 *   entity: 'Task',
 *   columns: ['title', 'status']
 * });
 * // resolved.component === 'DataTable'
 * // resolved.importPath === '@/components/organisms/DataTable'
 * ```
 */
export function resolvePattern(config: PatternConfig): MappedPattern {
  const { type } = config;

  // Look up component mapping
  const mapping = componentMapping[type];
  if (!mapping) {
    // Check if we have any mappings loaded
    if (Object.keys(componentMapping).length === 0) {
      log.warn('Component mapping not initialized. Call initializePatternResolver() at app startup.');
    }
    throw new Error(`Unknown pattern type: ${type}`);
  }

  // Check for deprecated patterns
  if (mapping.deprecated) {
    log.warn('Pattern is deprecated', {
      type,
      replacedBy: mapping.replacedBy,
    });
  }

  // validatePatternProps receives the full config and extracts serializable props
  const validatedProps = validatePatternProps(config);

  return {
    component: mapping.component,
    importPath: mapping.importPath,
    category: mapping.category,
    validatedProps,
  };
}

/**
 * Validate pattern props against the registry schema.
 * Returns normalized props with defaults applied.
 */
function validatePatternProps(config: AnyPatternConfig): Record<string, FieldValue> {
  const { type: patternType, ...rest } = config;
  const definition = patternRegistry[patternType];

  // Strip undefined and non-serializable values (callbacks, typed arrays of unknown).
  const definedProps: Record<string, FieldValue> = Object.fromEntries(
    Object.entries(rest).filter((entry): entry is [string, FieldValue] => {
      const v = entry[1];
      if (v === undefined || typeof v === 'function') return false;
      return true;
    })
  );

  // If no definition, return props as-is (allow unknown patterns)
  if (!definition || !definition.propsSchema) {
    return definedProps;
  }

  const validated: Record<string, FieldValue> = { ...definedProps };
  const schema = definition.propsSchema;

  // Check required props
  for (const [propName, propDef] of Object.entries(schema)) {
    if (propDef.required && !(propName in validated)) {
      // Don't throw, just warn - allows for flexibility
      log.warn('Missing required prop', { propName, patternType });
    }
  }

  return validated;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a pattern type is known.
 */
export function isKnownPattern(type: string): boolean {
  return type in componentMapping;
}

/**
 * Get all known pattern types.
 */
export function getKnownPatterns(): string[] {
  return Object.keys(componentMapping);
}

/**
 * Get patterns by category.
 */
export function getPatternsByCategory(category: string): string[] {
  return Object.entries(componentMapping)
    .filter(([, mapping]) => mapping.category === category)
    .map(([type]) => type);
}

/**
 * Get the component mapping for a pattern type.
 */
export function getPatternMapping(
  type: string
): ComponentMappingEntry | undefined {
  return componentMapping[type];
}

/**
 * Get the pattern definition from the registry.
 */
export function getPatternDefinition(
  type: string
): PatternDefinition | undefined {
  return patternRegistry[type];
}
