/**
 * Content-grade classification of render-ui patterns — the single owner of
 * "is this pattern a content body", so the wiring lint, the slot layer, and
 * future consumers never grow private lists.
 *
 * Registry-derived, not a name list: a pattern TYPE is a content body when
 * its registry entry declares a data inlet — a propsSchema prop stamped
 * `kind: 'entity'` by pattern-sync from the prop's `EntityRecord<T>` /
 * `EntityCollection<T>` type identity (the declared signal that replaces
 * name-matching; see PropKind in `./types.js`). A pattern INSTANCE is a
 * content body when it is a bound body tree (`@config.denseBodyContent`),
 * a composite with children, or of a content-body type. Chrome (icons,
 * buttons, nav, inputs) declares no inlet, so it needs no enumeration.
 *
 * Declared-coverage boundary: viz patterns whose data props are not
 * `EntityRecord`-typed (`chart`, `stat-display`, `stats-grid`, `graph-view`)
 * carry no `kind: 'entity'` inlet today, so a BARE viz write (no children)
 * classifies as chrome. In practice dashboards compose viz under a parent
 * with children, which the composite branch catches. Stamping those props
 * is a pattern-sync/core decision, not a consumer list.
 */

import { getPatternRuntimeDefinition } from './runtime-contract.js';
import type { AnyPatternConfig } from './pattern-types.js';
import type { RenderBinding } from '../types/effect.js';

/** The third element of a `render-ui` effect tuple. */
export type RenderUiPayload = AnyPatternConfig | RenderBinding | null;

/** True when the pattern type declares a data inlet — any propsSchema prop
 *  stamped `kind: 'entity'` from the prop's `EntityRecord`/`EntityCollection`
 *  type identity. Declared in the registry, never name-matched. */
export function isContentBodyPatternType(patternType: string): boolean {
  const entry = getPatternRuntimeDefinition(patternType);
  if (!entry?.propsSchema) return false;
  return Object.values(entry.propsSchema).some((def) => def.kind === 'entity');
}

export function isContentBodyPattern(pattern: RenderUiPayload): boolean {
  if (pattern === null) return false;
  if (typeof pattern === 'string') return true;
  if ('children' in pattern) {
    const children = pattern.children;
    if (Array.isArray(children) ? children.length > 0 : typeof children === 'object' && children !== null) return true;
  }
  return isContentBodyPatternType(pattern.type);
}

/** Type guard for a `['render-ui', 'main', payload]` effect tuple. */
export function isMainSlotRenderUi(effect: unknown): effect is ['render-ui', 'main', RenderUiPayload] {
  return Array.isArray(effect) && effect[0] === 'render-ui' && effect[1] === 'main';
}
