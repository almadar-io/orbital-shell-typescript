/**
 * Pattern Type for Orbital Units
 *
 * Re-exports pattern type definitions from @almadar/core/patterns,
 * which is the single source of truth for all pattern types.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ============================================================================
// Pattern Type - Re-exported from @almadar/core/patterns
// ============================================================================

/**
 * All valid pattern type names, imported from the @almadar/core/patterns registry.
 * The authoritative list is auto-generated from patterns-registry.json.
 */
export {
  PATTERN_TYPES,
  isValidPatternType,
} from '../patterns/index.js';
export type { PatternType } from '../patterns/index.js';

/**
 * Zod schema for pattern types.
 * Accepts any string - validation against full registry happens at runtime.
 */
export const PatternTypeSchema = z.string();
