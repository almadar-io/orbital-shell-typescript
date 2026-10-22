/**
 * Pattern Recommender
 *
 * Maps transition context (entity fields, domain category, UI state) to
 * ranked pattern suggestions using the registry's `suggestedFor` metadata,
 * category matching, and entity field type heuristics.
 *
 * Used by the design-transition tool to include top-N recommendations
 * in the LLM prompt context.
 *
 * @packageDocumentation
 */

import { patternsRegistry } from '../index.js';
import type { PatternType } from '../pattern-types.js';
import type { PatternPropDef } from '../types.js';

type PatternEntry = {
  category?: string;
  description?: string;
  suggestedFor?: string[];
  typicalSize?: string;
  propsSchema?: Record<string, PatternPropDef>;
  entityAware?: boolean;
};

type PatternsRegistryShape = {
  patterns?: Record<string, PatternEntry>;
};

// ============================================================================
// Types
// ============================================================================

/**
 * Context for pattern recommendation.
 */
export interface RecommendationContext {
  /** Current state name (e.g., "Browsing", "Creating") */
  state?: string;
  /** Triggering event (e.g., "INIT", "CREATE", "VIEW") */
  event?: string;
  /** Target UI slot */
  slot?: 'main' | 'modal' | 'drawer' | 'sidebar' | 'overlay';
  /** Domain category */
  domainCategory?: string;
  /** Entity field types present */
  entityFieldTypes?: string[];
  /** Entity has enum fields */
  hasEnumFields?: boolean;
  /** Entity has date/timestamp fields */
  hasDateFields?: boolean;
  /** Entity has numeric fields */
  hasNumericFields?: boolean;
  /** Entity has relation fields */
  hasRelationFields?: boolean;
  /** Entity has image/url fields */
  hasMediaFields?: boolean;
}

/**
 * A pattern recommendation with score and reasoning.
 */
export interface PatternRecommendation {
  /** Pattern type name */
  pattern: PatternType;
  /** Relevance score (0-100) */
  score: number;
  /** Why this pattern was recommended */
  reason: string;
  /** Pattern category */
  category: string;
  /** Pattern description */
  description: string;
  /** Key props to use */
  keyProps: string[];
}

// ============================================================================
// Domain → suggestedFor keyword mapping
// ============================================================================

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  business: ['admin panels', 'data-dense views', 'list pages', 'data entry', 'comparisons'],
  dashboard: ['dashboards', 'analytics', 'overview pages', 'overview screens', 'data visualization', 'reporting', 'KPI indicators'],
  'e-commerce': ['visual items', 'images', 'previews', 'data entry', 'list pages'],
  content: ['visual items', 'images', 'previews', 'media', 'pages with multiple views'],
  social: ['activity logs', 'visual items', 'previews'],
  workflow: ['process tracking', 'workflow steps', 'multi-step forms', 'wizards'],
  form: ['data entry', 'create forms', 'edit forms', 'multi-step forms'],
  game: ['game', 'real-time', 'interactive'],
};

/**
 * Event → relevant suggestedFor keywords
 */
const EVENT_KEYWORDS: Record<string, string[]> = {
  INIT: ['list pages', 'overview pages', 'dashboards', 'admin panels'],
  CREATE: ['create forms', 'data entry', 'multi-step forms'],
  EDIT: ['edit forms', 'data entry'],
  VIEW: ['detail pages', 'entity management', 'pages with multiple views'],
  DELETE: ['destructive actions', 'confirmations'],
  FILTER: ['filterable data', 'search functionality', 'quick filters'],
};

/**
 * Slot → category affinity (which categories belong in which slot)
 */
const SLOT_CATEGORY_AFFINITY: Record<string, string[]> = {
  main: ['display', 'dashboard', 'filter', 'header', 'layout', 'visualization', 'navigation', 'template'],
  modal: ['form', 'container', 'state'],
  drawer: ['display', 'form', 'navigation'],
  sidebar: ['navigation', 'filter'],
  overlay: ['container', 'state'],
};

/**
 * State → relevant categories
 */
const STATE_CATEGORY_AFFINITY: Record<string, string[]> = {
  Browsing: ['display', 'filter', 'header', 'dashboard', 'visualization'],
  Creating: ['form', 'navigation'],
  Editing: ['form', 'navigation'],
  Viewing: ['display', 'navigation'],
  Deleting: ['container', 'state'],
};

// ============================================================================
// Core Recommendation Engine
// ============================================================================

/**
 * Recommend patterns for a given context.
 *
 * Scoring algorithm:
 * 1. suggestedFor match with domain keywords (+30)
 * 2. suggestedFor match with event keywords (+25)
 * 3. Category affinity with slot (+20)
 * 4. Category affinity with state (+15)
 * 5. Entity field type bonus (+10 per matching heuristic)
 * 6. Entity-aware bonus for display patterns (+5)
 *
 * @returns Ranked pattern recommendations, highest score first
 */
export function recommendPatterns(
  context: RecommendationContext,
  maxResults: number = 10,
): PatternRecommendation[] {
  const patterns = (patternsRegistry as PatternsRegistryShape).patterns || {};
  const scores: Map<string, { score: number; reasons: string[] }> = new Map();

  const domainKeywords = context.domainCategory
    ? DOMAIN_KEYWORDS[context.domainCategory] || []
    : [];
  const eventKeywords = context.event
    ? EVENT_KEYWORDS[context.event] || []
    : [];
  const slotCategories = context.slot
    ? SLOT_CATEGORY_AFFINITY[context.slot] || []
    : [];
  const stateCategories = context.state
    ? STATE_CATEGORY_AFFINITY[context.state] || []
    : [];

  for (const [patternName, patternDef] of Object.entries(patterns) as [string, PatternEntry][]) {
    const suggestedFor: string[] = patternDef.suggestedFor || [];
    const category: string = patternDef.category || '';
    let score = 0;
    const reasons: string[] = [];

    // Skip game patterns for non-game domains
    if (category === 'game' && context.domainCategory !== 'game') continue;
    // Skip debug patterns
    if (category === 'debug') continue;
    // Skip template patterns (too high-level for transition design)
    if (category === 'template') continue;

    // 1. suggestedFor × domain keywords (+30 max)
    for (const keyword of domainKeywords) {
      if (suggestedFor.some(sf => sf.toLowerCase().includes(keyword.toLowerCase()))) {
        score += 30;
        reasons.push(`domain:${keyword}`);
        break; // Only count once
      }
    }

    // 2. suggestedFor × event keywords (+25 max)
    for (const keyword of eventKeywords) {
      if (suggestedFor.some(sf => sf.toLowerCase().includes(keyword.toLowerCase()))) {
        score += 25;
        reasons.push(`event:${keyword}`);
        break;
      }
    }

    // 3. Slot category affinity (+20)
    if (slotCategories.includes(category)) {
      score += 20;
      reasons.push(`slot:${context.slot}`);
    }

    // 4. State category affinity (+15)
    if (stateCategories.includes(category)) {
      score += 15;
      reasons.push(`state:${context.state}`);
    }

    // 5. Entity field type heuristics (+10 each)
    if (context.hasEnumFields && ['filter-group', 'tabs', 'badge'].includes(patternName)) {
      score += 10;
      reasons.push('enum-fields');
    }
    if (context.hasDateFields && ['timeline', 'chart'].includes(patternName)) {
      score += 10;
      reasons.push('date-fields');
    }
    if (context.hasNumericFields && ['stats', 'chart', 'meter', 'progress-bar'].includes(patternName)) {
      score += 10;
      reasons.push('numeric-fields');
    }
    if (context.hasRelationFields && ['tabs', 'master-detail-layout'].includes(patternName)) {
      score += 10;
      reasons.push('relation-fields');
    }
    if (context.hasMediaFields && ['data-grid', 'media-gallery'].includes(patternName)) {
      score += 10;
      reasons.push('media-fields');
    }

    // 6. Entity-aware bonus for display patterns (+5)
    if (category === 'display' || category === 'dashboard') {
      const propsSchema = patternDef.propsSchema || {};
      if ('entity' in propsSchema) {
        score += 5;
        reasons.push('entity-aware');
      }
    }

    if (score > 0) {
      scores.set(patternName, { score, reasons });
    }
  }

  // Sort by score, take top N
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, maxResults);

  return ranked.map(([patternName, { score, reasons }]) => {
    const patternDef = patterns[patternName];
    const propsSchema = patternDef.propsSchema || {};
    const keyProps = Object.keys(propsSchema)
      .filter(k => propsSchema[k]?.required === true)
      .slice(0, 5);

    // If no required props, show first few meaningful ones
    if (keyProps.length === 0) {
      const meaningful = Object.keys(propsSchema).filter(
        k => !['className', 'isLoading', 'error', 'entity'].includes(k)
      );
      keyProps.push(...meaningful.slice(0, 4));
    }

    return {
      pattern: patternName as PatternType,
      score,
      reason: reasons.join(', '),
      category: patternDef.category || 'unknown',
      description: patternDef.description || patternName,
      keyProps,
    };
  });
}

// ============================================================================
// Context Builder (from raw entity fields)
// ============================================================================

/**
 * Build recommendation context from entity field information.
 * Analyzes field types to set the boolean flags used by the recommender.
 */
export function buildRecommendationContext(options: {
  state?: string;
  event?: string;
  slot?: 'main' | 'modal' | 'drawer' | 'sidebar' | 'overlay';
  domainCategory?: string;
  entityFields?: Array<{ name: string; type: string; values?: string[] }>;
}): RecommendationContext {
  const fields = options.entityFields || [];
  const fieldTypes = fields.map(f => f.type);

  return {
    state: options.state,
    event: options.event,
    slot: options.slot,
    domainCategory: options.domainCategory,
    entityFieldTypes: fieldTypes,
    // Excludes `type: 'union'`: its `values` carries tagged-union variant
    // NAMES or a by-name recursive back-reference, never a real enum
    // vocabulary — counting it here would recommend enum-oriented patterns
    // (filter-group/tabs/badge) for a struct union or recursive struct field.
    hasEnumFields: fields.some(f => f.type === 'enum' || (f.type !== 'union' && f.values && f.values.length > 0)),
    hasDateFields: fields.some(f => ['date', 'datetime', 'timestamp'].includes(f.type)),
    hasNumericFields: fields.some(f => ['number', 'integer', 'float', 'decimal', 'currency'].includes(f.type)),
    hasRelationFields: fields.some(f => f.type === 'relation'),
    hasMediaFields: fields.some(f => ['image', 'url', 'media', 'file'].includes(f.type)),
  };
}

// ============================================================================
// Prompt Formatter
// ============================================================================

/**
 * Format recommendations as a concise prompt section.
 * Used to inject into the design-transition tool's user prompt.
 */
export function formatRecommendationsForPrompt(
  recommendations: PatternRecommendation[],
): string {
  if (recommendations.length === 0) return '';

  const lines = [
    '## Recommended Patterns',
    '',
    '| Pattern | Category | Key Props | Why |',
    '|---------|----------|-----------|-----|',
  ];

  for (const rec of recommendations) {
    const props = rec.keyProps.length > 0 ? rec.keyProps.join(', ') : '—';
    lines.push(`| ${rec.pattern} | ${rec.category} | ${props} | ${rec.reason} |`);
  }

  lines.push('');
  lines.push('Use these patterns where appropriate. Combine multiple for rich INIT transitions.');

  return lines.join('\n');
}
