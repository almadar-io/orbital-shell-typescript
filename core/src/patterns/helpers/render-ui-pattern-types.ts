/**
 * Render-ui pattern-type collection over `.orb` IR — the ONE home for the
 * walk both the free-mode coherence filter (rabit) and the facet ingest
 * (calibrate) derive a behavior's rendered `type:` vocabulary from.
 *
 * Pure JSON traversal: no fs, no caching, no policy. `@`-prefixed type
 * values (e.g. `@config.viewPattern`) are call-site config bindings resolved
 * at compose time, not literal pattern types, and are skipped.
 */

import { type JsonValue, isJsonArray, isJsonObject } from '../../types/json.js';
import type { SExpr, SExprObject } from '../../types/expression.js';
import type { Effect } from '../../types/effect.js';
import type { AnyPatternConfig } from '../pattern-types.js';

function collectPatternTypeTokens(node: JsonValue, out: Set<string>): void {
  if (!isJsonObject(node)) return;
  const type = node['type'];
  if (typeof type === 'string' && !type.startsWith('@')) out.add(type);
  const children = node['children'];
  if (isJsonArray(children)) {
    for (const child of children) collectPatternTypeTokens(child, out);
  }
}

/**
 * Walk an `.orb` IR value collecting every `["render-ui", <slot>, <node>]`
 * pattern node's literal `type:` tokens (including nested `children`).
 */
export function collectRenderUiPatternTypes(ir: JsonValue, out: Set<string>): void {
  if (isJsonArray(ir)) {
    if (ir.length >= 3 && ir[0] === 'render-ui' && typeof ir[1] === 'string') {
      collectPatternTypeTokens(ir[2], out);
    }
    for (const item of ir) collectRenderUiPatternTypes(item, out);
  } else if (isJsonObject(ir)) {
    for (const value of Object.values(ir)) collectRenderUiPatternTypes(value, out);
  }
}

/** Convenience form: the distinct render-ui `type:` tokens of one `.orb` IR. */
export function renderUiPatternTypesOf(ir: JsonValue): ReadonlySet<string> {
  const out = new Set<string>();
  collectRenderUiPatternTypes(ir, out);
  return out;
}

/** One slot a transition paints and the pattern it paints there. */
export interface RenderUiEntry {
  slot: string;
  pattern: AnyPatternConfig | SExprObject;
}

type EffectNode = Effect | SExpr;

function isPatternNode(value: EffectNode | AnyPatternConfig | undefined): value is AnyPatternConfig | SExprObject {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}

function collectRenderUiEntries(effect: EffectNode, out: RenderUiEntry[]): void {
  if (!Array.isArray(effect)) return;
  const head = effect[0];
  if (head === 'render-ui') {
    const slot = effect[1];
    const pattern = effect[2];
    if (typeof slot === 'string' && isPatternNode(pattern)) out.push({ slot, pattern });
    return;
  }
  for (const child of controlBody(effect)) collectRenderUiEntries(child, out);
}

/** The effects a control form runs; empty for every other effect. */
export function controlBody(effect: Effect | SExpr[]): readonly EffectNode[] {
  switch (effect[0]) {
    case 'do':
    case 'atomic':
      return effect.slice(1);
    case 'if':
    case 'when':
      return effect.slice(2);
    case 'let':
      return effect.slice(2);
    default:
      return [];
  }
}

/**
 * Every `render-ui` a transition's effects perform, in order — including ones
 * nested inside `do` / `if` / `when` / `let` / `atomic` bodies.
 * Entries reference the schema's own pattern objects (never copies), so an
 * editor can mutate what it finds. A `null` (clear-slot) render and a pattern
 * given as a binding string are not entries.
 */
export function renderUiEntriesOf(effects: readonly SExpr[]): Array<{ slot: string; pattern: SExprObject }>;
export function renderUiEntriesOf(effects: readonly EffectNode[]): RenderUiEntry[];
export function renderUiEntriesOf(effects: readonly EffectNode[]): RenderUiEntry[] {
  const out: RenderUiEntry[] = [];
  for (const effect of effects) collectRenderUiEntries(effect, out);
  return out;
}
