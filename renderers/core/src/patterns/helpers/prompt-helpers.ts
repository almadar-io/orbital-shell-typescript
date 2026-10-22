/**
 * Prompt Helpers for @almadar/patterns
 * 
 * Helper functions for generating prompts/documentation from pattern registry.
 * Used by @almadar/skills package and other tools.
 * 
 * @packageDocumentation
 */

import { patternsRegistry } from '../index.js';
import type { PatternType } from '../pattern-types.js';
import type { PatternPropDef } from '../types.js';

type PatternEntry = {
  category?: string;
  description?: string;
  propsSchema?: Record<string, PatternPropDef>;
  entityAware?: boolean;
};

type PatternsRegistryShape = {
  patterns?: Record<string, PatternEntry>;
};

/**
 * Get patterns grouped by category.
 * Categories are derived from pattern registry metadata.
 */
export function getPatternsGroupedByCategory(): Record<string, PatternType[]> {
  const patterns = (patternsRegistry as PatternsRegistryShape).patterns || {};
  const grouped: Record<string, PatternType[]> = {};

  for (const [patternName, patternDef] of Object.entries(patterns)) {
    const category = patternDef.category || 'uncategorized';
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(patternName as PatternType);
  }

  return grouped;
}

/**
 * Get compact pattern props reference table.
 * Generates markdown table of pattern names and their key props.
 */
export function getPatternPropsCompact(): string {
  const patterns = (patternsRegistry as PatternsRegistryShape).patterns || {};
  const lines: string[] = [
    '| Pattern | Key Props |',
    '|---------|-----------|',
  ];

  for (const [patternName, patternDef] of Object.entries(patterns)) {
    const propsSchema = patternDef.propsSchema || {};
    const requiredProps = Object.keys(propsSchema).filter(
      (key) => propsSchema[key]?.required === true
    );
    const keyProps = requiredProps.length > 0 
      ? requiredProps.join(', ') 
      : Object.keys(propsSchema).slice(0, 3).join(', ');
    
    lines.push(`| ${patternName} | ${keyProps} |`);
  }

  return lines.join('\n');
}

/**
 * Get pattern action props reference.
 * Lists patterns that have action/event props (buttons, forms, etc.).
 */
export function getPatternActionsRef(): string {
  const patterns = (patternsRegistry as PatternsRegistryShape).patterns || {};
  const lines: string[] = [
    '## Pattern Action Props',
    '',
    '| Pattern | Action Props | Notes |',
    '|---------|-------------|-------|',
  ];

  for (const [patternName, patternDef] of Object.entries(patterns)) {
    const propsSchema = patternDef.propsSchema || {};
    const actionProps: string[] = [];

    // Check for common action prop patterns
    for (const [propName, propDef] of Object.entries(propsSchema)) {
      if (
        propName.includes('action') ||
        propName.includes('Action') ||
        propName.includes('event') ||
        propName.includes('Event') ||
        propName === 'onSubmit' ||
        propName === 'onClick'
      ) {
        actionProps.push(propName);
      }
    }

    if (actionProps.length > 0) {
      const notes = patternDef.description || '';
      lines.push(`| ${patternName} | ${actionProps.join(', ')} | ${notes.slice(0, 50)} |`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate pattern description from metadata.
 * Auto-generates human-readable description from pattern props schema.
 */
export function generatePatternDescription(patternType: string): string {
  const patterns = (patternsRegistry as PatternsRegistryShape).patterns || {};
  const patternDef = patterns[patternType];
  
  if (!patternDef) {
    return patternType;
  }

  const desc = patternDef.description;
  if (desc) {
    return desc;
  }

  // Auto-generate from props
  const propsSchema = patternDef.propsSchema || {};
  const propCount = Object.keys(propsSchema).length;
  const requiredProps = Object.keys(propsSchema).filter(
    (key) => propsSchema[key]?.required === true
  );

  if (requiredProps.length > 0) {
    return `${patternType} (requires: ${requiredProps.join(', ')})`;
  }

  return `${patternType} (${propCount} props)`;
}

/**
 * Get all pattern types as array.
 */
export function getAllPatternTypes(): PatternType[] {
  const patterns = (patternsRegistry as PatternsRegistryShape).patterns || {};
  return Object.keys(patterns) as PatternType[];
}

/**
 * Get pattern metadata for a specific pattern.
 */
export function getPatternMetadata(patternType: string): PatternEntry | null {
  const patterns = (patternsRegistry as PatternsRegistryShape).patterns || {};
  return patterns[patternType] || null;
}

/**
 * Entity-aware patterns that are still allowed in .orb render-ui trees.
 * These are the standard building blocks used across all golden behaviors
 * despite having an `entity` prop.
 */
const ORB_ALLOWED_ENTITY_PATTERNS = new Set([
  'data-list',
  'data-grid',
  'search-input',
  'form-section',
  'meter',
  'table-view',
  'filter-group',
  'timeline',
  'media-gallery',
]);

/**
 * Categories to exclude from .orb render-ui guidance (debug, templates).
 * The `game` category is allowed so 2D game patterns compose in free mode;
 * 3D game patterns are excluded by the `3-d`/`3d` name guard below.
 */
const ORB_EXCLUDED_CATEGORIES = new Set([
  'debug', 'template',
]);

/**
 * Get patterns allowed in .orb render-ui trees.
 *
 * Returns all non-entity patterns (atoms/molecules) plus the allowed
 * entity-aware exceptions (data-list, data-grid, search-input, form-section,
 * meter, table-view, filter-group, timeline, media-gallery).
 * Excludes debug and template categories, plus any 3D-named patterns.
 *
 * Grouped by registry category with description and key props.
 */
export function getOrbAllowedPatterns(): Record<string, Array<{
  name: string;
  description: string;
  keyProps: string[];
}>> {
  const patterns = (patternsRegistry as PatternsRegistryShape).patterns || {};
  const grouped: Record<string, Array<{ name: string; description: string; keyProps: string[] }>> = {};

  for (const [name, def] of Object.entries(patterns)) {
    const cat = def.category || 'uncategorized';
    if (ORB_EXCLUDED_CATEGORIES.has(cat)) continue;
    if (name.includes('3-d') || name.includes('3d')) continue;

    const hasEntity = def.propsSchema && 'entity' in def.propsSchema;
    if (hasEntity && !ORB_ALLOWED_ENTITY_PATTERNS.has(name)) continue;

    const propsSchema = def.propsSchema || {};
    const keyProps = Object.keys(propsSchema).slice(0, 5);

    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      name,
      description: def.description || '',
      keyProps,
    });
  }

  return grouped;
}

/**
 * Get compact markdown reference of .orb-allowed patterns.
 * Derives everything from the registry. No hardcoded pattern lists.
 */
export function getOrbAllowedPatternsCompact(): string {
  const grouped = getOrbAllowedPatterns();
  const lines: string[] = [];

  for (const [cat, items] of Object.entries(grouped).sort()) {
    lines.push(`#### ${cat} (${items.length})`);
    lines.push('| Pattern | Description | Key Props |');
    lines.push('|---------|-------------|-----------|');
    for (const item of items) {
      const desc = item.description.split('\n')[0].slice(0, 60);
      lines.push(`| \`${item.name}\` | ${desc} | ${item.keyProps.join(', ')} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get a slim one-line-per-pattern catalog for Gate 3.5 pattern selection.
 * Format: "- pattern-name: one-line description"
 * Much smaller than the full compact reference (~800 tokens vs ~3,500).
 */
export function getOrbAllowedPatternsSlim(): string {
  const grouped = getOrbAllowedPatterns();
  const lines: string[] = [];

  for (const [cat, items] of Object.entries(grouped).sort()) {
    lines.push(`## ${cat}`);
    for (const item of items) {
      const desc = item.description.split('\n')[0].slice(0, 80);
      lines.push(`- ${item.name}: ${desc}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get compact markdown reference for a filtered subset of patterns.
 * Used by Gate 4 after Gate 3.5 selects the relevant patterns.
 * Includes all props (not just top 5) since we're showing fewer patterns.
 */
export function getOrbAllowedPatternsFiltered(patternNames: string[]): string {
  const nameSet = new Set(patternNames);
  const patterns = (patternsRegistry as PatternsRegistryShape).patterns || {};
  const grouped: Record<string, Array<{ name: string; description: string; allProps: string[] }>> = {};

  for (const [name, def] of Object.entries(patterns)) {
    if (!nameSet.has(name)) continue;
    const cat = def.category || 'uncategorized';
    const propsSchema = def.propsSchema || {};
    const allProps = Object.keys(propsSchema);

    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      name,
      description: def.description || '',
      allProps,
    });
  }

  const lines: string[] = [];
  for (const [cat, items] of Object.entries(grouped).sort()) {
    lines.push(`#### ${cat} (${items.length})`);
    lines.push('| Pattern | Description | Props |');
    lines.push('|---------|-------------|-------|');
    for (const item of items) {
      const desc = item.description.split('\n')[0].slice(0, 60);
      lines.push(`| \`${item.name}\` | ${desc} | ${item.allProps.join(', ')} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
