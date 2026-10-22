/**
 * Render-UI structural editing — the single canonical pattern-tree navigator,
 * mutators, and overlay application. Promoted out of apps/builder so the studio
 * client, rabit's contextual-edit path, and the overlay replay share ONE
 * implementation (no shadow copies).
 *
 * Operates on the SERIALIZABLE structural pattern node — the resolved `.orb`
 * render-ui shape (`{ type, children, ...props }`, props are strings/numbers/
 * booleans/bindings/arrays). It never holds function-typed props: those exist
 * only in the React-component `AnyPatternConfig`, never in resolved IR. A node
 * to insert/swap is built as a structural literal and validated against the
 * pattern registry by the caller — `AnyPatternConfig` is never assigned in.
 */

import type { OrbitalDefinition, Trait, Effect } from './types/index.js';
import { renderUiEntriesOf } from './patterns/helpers/render-ui-pattern-types.js';

// ----------------------------------------------------------------------------
// Structural pattern node
// ----------------------------------------------------------------------------

/** A serializable value inside a render-ui pattern node. No functions. */
export type PatternValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | PatternNode
  | readonly PatternValue[];

/**
 * One node in a render-ui pattern tree as it appears in resolved `.orb`. A
 * child is a nested node or a `@trait.X` embed (another trait's render).
 */
export interface PatternNode {
  type?: string;
  children?: Array<PatternNode | string>;
  [prop: string]: PatternValue | Array<PatternNode | string> | undefined;
}

// ----------------------------------------------------------------------------
// EditFocus — a canvas selection resolved to an address in the resolved `.orb`
// ----------------------------------------------------------------------------

export type EditFocusLevel =
  | 'node'
  | 'slot'
  | 'field'
  | 'effect'
  | 'trait'
  | 'page'
  | 'orbital';

/** A pointed-at element. Plain data — constructible with or without a DOM. */
export interface EditFocus {
  level: EditFocusLevel;
  orbital: string;
  trait?: string;
  transition?: string;
  state?: string;
  slot?: string;
  path?: string;
  patternType?: string;
  entity?: string;
  source?: string;
  label: string;
}

// ----------------------------------------------------------------------------
// RenderUiPatch — a structural render-ui edit, replayed after factory expansion
// ----------------------------------------------------------------------------

export type RenderUiPatchOp = 'replace' | 'insert' | 'remove' | 'set-prop' | 'rebind';

export interface RenderUiPatchAddress {
  trait: string;
  transition: string;
  state?: string;
  slot: string;
  /** patternPath, e.g. `root.children.2`. For `insert`, the PARENT path. */
  path: string;
}

export interface RenderUiPatch {
  op: RenderUiPatchOp;
  address: RenderUiPatchAddress;
  /** Structural fingerprint of the pre-edit node, used to re-anchor the patch
   *  if a later factory rebuild shifts `address.path`. */
  fingerprint?: string;
  /** For `replace` / `insert`: the concrete node to place. */
  node?: PatternNode;
  /** For `insert`: index within the parent's children (default: append). */
  index?: number;
  /** For `set-prop` / `rebind`: the prop key. */
  prop?: string;
  /** For `set-prop`: the new value. For `rebind`: pass the binding via `value`. */
  value?: PatternValue;
}

// ----------------------------------------------------------------------------
// Pure node primitives
// ----------------------------------------------------------------------------

/** The children array of a node: `children`, or `props.children` (the nested form some IR passes emit). */
function childrenOf(node: PatternNode): Array<PatternNode | string> | null {
  if (Array.isArray(node.children)) return node.children;
  const props = node.props;
  if (props && typeof props === 'object' && !Array.isArray(props) && !(props instanceof Date)) {
    const nested = (props as PatternNode).children;
    if (Array.isArray(nested)) return nested;
  }
  return null;
}

/**
 * Navigate a path as the renderer emits it (`root`, `root.children.0`,
 * `root.children.1.children.0`) to a node. The leading `root` is a label, not
 * a key; a path without it is accepted too.
 */
export function navigatePatternPath(root: PatternNode, path: string): PatternNode | null {
  if (!path || path === 'root') return root;
  const parts = (path.startsWith('root.') ? path.slice('root.'.length) : path).split('.');
  let current: PatternNode | Array<PatternNode | string> | null = root;
  for (const part of parts) {
    if (current === null) return null;
    if (Array.isArray(current)) {
      const idx = Number.parseInt(part, 10);
      if (Number.isNaN(idx) || idx < 0 || idx >= current.length) return null;
      const item: PatternNode | string | undefined = current[idx];
      current = item && typeof item === 'object' && !Array.isArray(item) ? item : null;
    } else if (part === 'children') {
      current = childrenOf(current);
    } else {
      const value: PatternValue | PatternNode[] | undefined = current[part];
      current = value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) ? (value as PatternNode) : null;
    }
  }
  return Array.isArray(current) ? null : current;
}

/** `<parent>.children.<i>` → the parent's path and the index; null for anything else. */
export function splitPatternChildPath(path: string): { parentPath: string; index: number } | null {
  const match = /^(.*)\.children\.(\d+)$/.exec(path) ?? /^children\.(\d+)$/.exec(path);
  if (!match) return null;
  if (match.length === 2) return { parentPath: 'root', index: Number.parseInt(match[1], 10) };
  return { parentPath: match[1], index: Number.parseInt(match[2], 10) };
}

/** Set a prop on the node at `path`. Returns false if the path misses. */
export function setPropAtPath(
  root: PatternNode,
  path: string,
  prop: string,
  value: PatternValue,
): boolean {
  const node = navigatePatternPath(root, path);
  if (!node) return false;
  node[prop] = value;
  return true;
}

/** Replace the node at a child path (`<parent>.children.<i>`) with `node`. */
export function replaceChildAtPath(root: PatternNode, path: string, node: PatternNode): boolean {
  const split = splitPatternChildPath(path);
  if (!split) return false;
  const parent = navigatePatternPath(root, split.parentPath);
  const children = parent ? childrenOf(parent) : null;
  if (!children || split.index >= children.length) return false;
  children[split.index] = node;
  return true;
}

/** Insert `node` into the parent's `children` at `index` (clamped to end). */
export function insertChildAtPath(
  root: PatternNode,
  parentPath: string,
  index: number,
  node: PatternNode,
): boolean {
  const parent = navigatePatternPath(root, parentPath);
  if (!parent) return false;
  const children = childrenOf(parent) ?? [];
  const i = index < 0 || index > children.length ? children.length : index;
  children.splice(i, 0, node);
  if (!childrenOf(parent)) parent.children = children;
  return true;
}

/** Remove the node at a child path. */
export function removeChildAtPath(root: PatternNode, path: string): boolean {
  const split = splitPatternChildPath(path);
  if (!split) return false;
  const parent = navigatePatternPath(root, split.parentPath);
  const children = parent ? childrenOf(parent) : null;
  if (!children || split.index >= children.length) return false;
  children.splice(split.index, 1);
  return true;
}

/** Replace a node's contents in place (used to swap the render-ui root). */
function replaceNodeInPlace(target: PatternNode, source: PatternNode): void {
  for (const key of Object.keys(target)) {
    delete target[key];
  }
  Object.assign(target, source);
}

// ----------------------------------------------------------------------------
// Fingerprint (re-anchor)
// ----------------------------------------------------------------------------

function stableValue(value: PatternValue | PatternNode[] | undefined): string {
  if (value === undefined) return 'u';
  if (value === null) return 'n';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  const nodeType = 'type' in value ? value.type : undefined;
  return `{${typeof nodeType === 'string' ? nodeType : ''}}`;
}

/** Deterministic structural fingerprint of a node (excludes child contents;
 *  identifies the base node so a patch can re-anchor after a path shift). */
export function fingerprintNode(node: PatternNode): string {
  const props = Object.keys(node)
    .filter((k) => k !== 'children')
    .sort()
    .map((k) => `${k}=${stableValue(node[k])}`)
    .join(',');
  const childCount = Array.isArray(node.children) ? node.children.length : 0;
  return `t:${node.type ?? ''}|${props}|c:${childCount}`;
}

function findByFingerprint(node: PatternNode, path: string, fp: string): string | null {
  if (fingerprintNode(node) === fp) return path;
  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (typeof child === 'string') continue;
      const r = findByFingerprint(child, `${path}.children.${i}`, fp);
      if (r) return r;
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// Overlay application
// ----------------------------------------------------------------------------

export interface RenderOverlayResult {
  applied: number;
  /** Patches whose target node could not be resolved (path gone + fingerprint
   *  unmatched). Surfaced as `patch_stale` — never silently dropped. */
  stale: RenderUiPatch[];
}

/** A render-ui effect's slot + root pattern node, validated from the canonical
 *  `Effect` tuple. The `['render-ui', slot, config]` form carries the structural
 *  pattern node at index 2 in resolved `.orb`; we narrow `Effect` by its tag and
 *  validate the payload is a concrete node (not a `@binding` string or null). */

/** Narrow a trait reference to an inline `Trait` (the only `TraitRef` member
 *  with a `stateMachine`). No cast — `in` narrows the union. */
function asInlineTrait(ref: OrbitalDefinition['traits'][number]): Trait | null {
  if (typeof ref === 'object' && ref !== null && 'stateMachine' in ref) {
    return ref;
  }
  return null;
}

/** Where a trait's render lives: the transition (by event, optionally its from-state) and the slot. */
export interface RenderRootAddress {
  transition: string;
  state?: string;
  slot: string;
}

/**
 * The render-ui root a trait paints for an address, including renders nested
 * in control forms (`when`/`if`). Prefers the exact transition; an empty
 * transition (a canvas selection with no provenance) takes the first render
 * into that slot.
 */
export function renderRootOf(trait: Trait, address: RenderRootAddress): PatternNode | null {
  const wantTransition = address.transition !== '';
  const wantState = address.state !== undefined && address.state !== '';
  let fallback: PatternNode | null = null;
  for (const t of trait.stateMachine?.transitions ?? []) {
    if (wantState && t.from !== address.state) continue;
    for (const entry of renderUiEntriesOf(t.effects ?? [])) {
      if (entry.slot !== address.slot) continue;
      const node = entry.pattern as PatternNode;
      if (wantTransition && t.event === address.transition) return node;
      if (!wantTransition) fallback ??= node;
    }
  }
  return fallback;
}

/** Find the render-ui root node for a patch address (see `renderRootOf`). */
function findRenderUiRoot(
  orbital: OrbitalDefinition,
  address: RenderUiPatchAddress,
): PatternNode | null {
  for (const ref of orbital.traits) {
    const trait = asInlineTrait(ref);
    if (trait && trait.name === address.trait) return renderRootOf(trait, address);
  }
  return null;
}

/** Resolve the effective path for a patch, re-anchoring by fingerprint. */
function resolvePath(root: PatternNode, patch: RenderUiPatch): string | null {
  if (patch.op === 'insert') {
    return navigatePatternPath(root, patch.address.path) ? patch.address.path : null;
  }
  const atPath = navigatePatternPath(root, patch.address.path);
  if (atPath && (patch.fingerprint === undefined || fingerprintNode(atPath) === patch.fingerprint)) {
    return patch.address.path;
  }
  if (patch.fingerprint !== undefined) {
    return findByFingerprint(root, 'root', patch.fingerprint);
  }
  return null;
}

function applyOnePatch(orbital: OrbitalDefinition, patch: RenderUiPatch): boolean {
  const root = findRenderUiRoot(orbital, patch.address);
  if (!root) return false;
  const path = resolvePath(root, patch);
  if (path === null) return false;

  switch (patch.op) {
    case 'set-prop':
    case 'rebind':
      return patch.prop !== undefined && setPropAtPath(root, path, patch.prop, patch.value);
    case 'remove':
      return removeChildAtPath(root, path);
    case 'insert':
      return patch.node !== undefined
        && insertChildAtPath(root, path, patch.index ?? Number.MAX_SAFE_INTEGER, patch.node);
    case 'replace': {
      if (patch.node === undefined) return false;
      if (path === 'root') {
        const target = navigatePatternPath(root, 'root');
        if (!target) return false;
        replaceNodeInPlace(target, patch.node);
        return true;
      }
      return replaceChildAtPath(root, path, patch.node);
    }
    default:
      return false;
  }
}

/**
 * Replay render-ui patches onto a resolved orbital, in place. Deterministic:
 * given the same base + patches, produces the same tree. Patches that cannot be
 * anchored are returned in `stale` (never silently dropped or misapplied).
 */
export function applyRenderOverlay(
  orbital: OrbitalDefinition,
  patches: readonly RenderUiPatch[],
): RenderOverlayResult {
  let applied = 0;
  const stale: RenderUiPatch[] = [];
  for (const patch of patches) {
    if (applyOnePatch(orbital, patch)) {
      applied += 1;
    } else {
      stale.push(patch);
    }
  }
  return { applied, stale };
}
