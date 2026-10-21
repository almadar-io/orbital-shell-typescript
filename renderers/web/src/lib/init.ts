/**
 * Pattern Resolver Initialization
 *
 * Loads pattern registry and component mapping from @almadar/core/patterns
 * and initializes the pattern resolver at app startup.
 *
 * @packageDocumentation
 */

import { initializePatternResolver } from './pattern-resolver';
import { createLogger } from '@almadar/logger';

// Import patterns data from @almadar/core/patterns (JSON is inlined in the package bundle)
import { componentMapping as componentMappingJson, patternsRegistry as registryJson } from '@almadar/core/patterns';

const log = createLogger('almadar:ui:pattern-resolver');

// Type definitions for the JSON structures
interface ComponentMappingJson {
  mappings: Record<string, {
    component: string;
    importPath: string;
    category: string;
    deprecated?: boolean;
    replacedBy?: string;
  }>;
}

interface PatternDefinition {
  type: string;
  category: string;
  description: string;
  propsSchema?: Record<string, {
    required?: boolean;
    types?: string[];
    description?: string;
  }>;
}

interface RegistryJson {
  patterns: Record<string, PatternDefinition>;
}

/**
 * Initialize the pattern resolver with shared pattern data.
 * Must be called once at app startup before any pattern rendering.
 * @returns The number of patterns initialized
 */
export function initializePatterns(): number {
  log.debug('initializePatterns called');
  log.debug('componentMappingJson loaded', () => ({ json: JSON.stringify(componentMappingJson) }));
  log.debug('registryJson keys', { keys: Object.keys(registryJson) });

  // Extract mappings from component-mapping.json (has { mappings: {...} })
  const componentMappingData = componentMappingJson as ComponentMappingJson;
  const componentMapping = componentMappingData.mappings || {};

  log.debug('Extracted mappings count', { count: Object.keys(componentMapping).length });
  log.debug('Sample mappings', { samples: Object.keys(componentMapping).slice(0, 5) });

  // Extract patterns from registry.json (has { patterns: {...} })
  const registryData = registryJson as RegistryJson;
  const patternRegistry = registryData.patterns || {};

  log.debug('Extracted patterns count', { count: Object.keys(patternRegistry).length });

  // Initialize the pattern resolver with the data
  // Use type assertion since JSON types are compatible at runtime
  initializePatternResolver({
    componentMapping,
    patternRegistry,
  });

  log.info('Initialized', {
    componentMappings: Object.keys(componentMapping).length,
    patternDefinitions: Object.keys(patternRegistry).length,
  });

  return Object.keys(componentMapping).length;
}
