'use client';

/**
 * LayersPanel
 *
 * Figma-style layers tree for an OrbitalSchema. Thin adapter over FileTree's
 * generic `items` mode — all it does is flatten the schema into
 * `FileTreeItem[]` via `schemaToLayerItems` and render `<FileTree look="nav" />`.
 * No tree/panel logic of its own.
 *
 * ---------------------------------------------------------------------------
 * ID scheme (stable, parseable, '/'-joined path of typed segments)
 * ---------------------------------------------------------------------------
 *   orbital:<orbitalName>
 *   orbital:<orbitalName>/page:<pageName>
 *   orbital:<orbitalName>/trait:<traitName>
 *   orbital:<orbitalName>/trait:<traitName>/transition:<index>
 *   orbital:<orbitalName>/trait:<traitName>/transition:<index>/slot:<slotName>
 *   orbital:<orbitalName>/trait:<traitName>/transition:<index>/slot:<slotName>/pattern:<slotIndex>:<patternPath>
 *
 * The transition segment uses the transition's array INDEX (not its event
 * name) because two transitions in the same trait can share an event name
 * (same event fired from different `from` states) — the index is the only
 * value `parseTraitLevel`/`parseTransitionLevel` guarantee is unique. The
 * slot segment uses the slot's NAME (render-ui slots are conventionally
 * distinct within one transition); the `pattern:<slotIndex>` part of the
 * final leaf's key disambiguates the rare case of two render-ui effects
 * targeting the same slot name within one transition by falling back to
 * their position among that transition's render-ui effects.
 *
 * `<patternPath>` is the same schema-compatible address `UISlotRenderer`
 * stamps as `data-pattern-path` and `useSchemaEditor`'s `navigatePatternPath`
 * / `splitPatternChildPath` consume: `root` for the render-ui root, then
 * `root.children.<i>`, `root.children.<i>.children.<j>`, … recursing into
 * every nested pattern's `children` (an array, or a single bare pattern
 * object — both normalized the same way `UISlotRenderer.renderPatternChildren`
 * does). Non-object children (`@entity.X` / `@trait.X` string bindings,
 * literals) are bindings, not nested patterns, and never get a row. Every
 * pattern node in the render-ui tree — root and nested alike — gets its own
 * `pattern:<slotIndex>:<patternPath>` leaf, parented to its containing
 * pattern's row (or the slot row, for `root`), so a consumer can walk the
 * exact tree `schemaEditor.movePattern`/`removePattern`/`updatePatternProp`
 * address.
 *
 * This is backward-compatible one level up: every non-pattern segment
 * (`orbital:` / `page:` / `trait:` / `transition:` / `slot:`) is unchanged,
 * so a consumer parsing only those levels (e.g. to resolve which orbital a
 * click belongs to) needs no changes. Only the trailing pattern leaf's key
 * gained the `:<patternPath>` suffix — use the exported `parseLayerId` to
 * read it instead of re-deriving the regex.
 *
 * Hierarchy choice: orbitals are the roots, with each orbital's `pages` and
 * `traits` as sibling children (an OrbitalDefinition owns both directly).
 * A schema has no cross-orbital "Page" entity and no data linking a
 * render-ui slot back to a specific page route, so a page-rooted tree
 * (pages containing the orbitals that render on them) is not derivable
 * without guessing — forbidden by the no-heuristics rule. See the Wave D3
 * report for this deviation from the literal "pages → orbitals → ..." spec
 * line.
 *
 * @packageDocumentation
 */

import React, { useMemo } from 'react';
import type { OrbitalSchema, SExpr, SExprObject } from '@almadar/core';
import { FileTree, type FileTreeItem } from '../../core/molecules/FileTree';

// ---------------------------------------------------------------------------
// Pure mapper — unit-testable without rendering
// ---------------------------------------------------------------------------

import {
  parseApplicationLevel,
  parseOrbitalLevel,
  parseTraitLevel,
  traitTransitionRenderUi,
} from '../../../lib/avl-schema-parser';

/** Narrows an `SExpr` to its object-literal branch — a nested pattern config, never an `@entity.X`/`@trait.X` binding string or other literal. */
function isSExprObject(value: SExpr | undefined): value is SExprObject {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalizes an authored `children` prop value into an array, same as a
 * bare single child. Mirrors `UISlotRenderer.renderPatternChildren`'s
 * array-or-bare-object normalization exactly — including keeping every
 * entry (bindings and literals included) at its ORIGINAL index. That index
 * is the address `data-pattern-path` / `navigatePatternPath` walk (they
 * index the raw children array, oblivious to which entries are nested
 * patterns), so a non-object entry earlier in the array still has to shift
 * every pattern after it to the right patternPath — filtering here first
 * would silently misaddress every sibling that follows a binding.
 */
function normalizeChildren(children: SExpr | undefined): SExpr[] {
  if (children === undefined || children === null) return [];
  return Array.isArray(children) ? children : [children];
}

/** Direct-read `label`/`text`/`content` prop (no heuristics — a plain string value, or nothing) used to distinguish same-type sibling rows, e.g. two buttons, or three `typography` nodes whose text lives in `content`. */
function distinguishingSuffix(config: SExprObject): string | undefined {
  if (typeof config.label === 'string' && config.label.length > 0) return config.label;
  if (typeof config.text === 'string' && config.text.length > 0) return config.text;
  if (typeof config.content === 'string' && config.content.length > 0) return config.content;
  return undefined;
}

/** Row label for a pattern node: its `type`, plus a distinguishing suffix when trivially available. A non-object render-ui target (a `@config.X` binding) has no `type` to read — label with the binding itself. */
function patternRowLabel(value: SExpr | undefined): string {
  if (isSExprObject(value)) {
    const type = typeof value.type === 'string' ? value.type : 'unknown';
    const suffix = distinguishingSuffix(value);
    return suffix ? `${type} — ${suffix}` : type;
  }
  return value === undefined || value === null ? 'unknown' : String(value);
}

/**
 * Pushes one pattern-tree row for `config` at `patternPath`, then recurses
 * into its `children` (no depth limit — the render-ui tree is finite by
 * construction). `slotId`/`slotIndex` are fixed for the whole recursion:
 * every row descending from one render-ui effect shares the same
 * `pattern:<slotIndex>` key, differing only in the trailing `:<patternPath>`.
 */
function pushPatternRows(
  items: FileTreeItem[],
  slotId: string,
  slotIndex: number,
  parentRowId: string,
  patternPath: string,
  config: SExpr | undefined,
): void {
  const id = `${slotId}/pattern:${slotIndex}:${patternPath}`;
  items.push({ id, label: patternRowLabel(config), parentId: parentRowId, icon: 'component' });
  if (!isSExprObject(config)) return;

  normalizeChildren(config.children).forEach((child, index) => {
    // Non-object entries (`@entity.X` / `@trait.X` bindings, literals) are
    // not nested patterns — no row — but the index is still consumed so
    // later object siblings keep their real (raw-array) patternPath.
    if (!isSExprObject(child)) return;
    pushPatternRows(items, slotId, slotIndex, id, `${patternPath}.children.${index}`, child);
  });
}

/**
 * Flattens an OrbitalSchema into FileTree's `items` shape. See the ID scheme
 * doc comment above the file header for the exact id grammar.
 */
export function schemaToLayerItems(schema: OrbitalSchema): FileTreeItem[] {
  const items: FileTreeItem[] = [];
  const seenSlotIds = new Set<string>();

  for (const appOrbital of parseApplicationLevel(schema).orbitals) {
    const orbitalId = `orbital:${appOrbital.name}`;
    items.push({ id: orbitalId, label: appOrbital.name, icon: 'box' });

    const orbitalData = parseOrbitalLevel(schema, appOrbital.name);
    if (!orbitalData) continue;

    for (const page of orbitalData.pages) {
      items.push({
        id: `${orbitalId}/page:${page.name}`,
        label: page.name,
        parentId: orbitalId,
        icon: 'file-text',
      });
    }

    for (const traitInfo of orbitalData.traits) {
      const traitId = `${orbitalId}/trait:${traitInfo.name}`;
      items.push({ id: traitId, label: traitInfo.name, parentId: orbitalId, icon: 'git-branch' });

      const traitData = parseTraitLevel(schema, appOrbital.name, traitInfo.name);
      if (!traitData) continue;
      const renderUi = traitTransitionRenderUi(schema, appOrbital.name, traitInfo.name);

      traitData.transitions.forEach((transition, transitionIndex) => {
        const transitionId = `${traitId}/transition:${transitionIndex}`;
        items.push({
          id: transitionId,
          label: transition.event || `${transition.from} → ${transition.to}`,
          parentId: traitId,
          icon: 'zap',
        });

        (renderUi[transitionIndex] ?? []).forEach((entry, slotIndex) => {
          const slotName = entry.slot;
          const slotId = `${transitionId}/slot:${slotName}`;
          if (!seenSlotIds.has(slotId)) {
            seenSlotIds.add(slotId);
            items.push({ id: slotId, label: slotName, parentId: transitionId, icon: 'layout-panel-top' });
          }
          pushPatternRows(items, slotId, slotIndex, slotId, 'root', entry.pattern);
        });
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Id parsing — the inverse of schemaToLayerItems
// ---------------------------------------------------------------------------

/** Every field a LayersPanel id can carry, populated up to whatever depth the id reaches. `orbitalName` is the only field guaranteed present. */
export interface LayerIdParts {
  orbitalName: string;
  pageName?: string;
  traitName?: string;
  /** The transition's array INDEX (see the id-scheme doc comment — not its event name). */
  transitionIndex?: number;
  slotName?: string;
  /** Position among the slot's render-ui effects (disambiguates two effects targeting the same slot name). */
  patternSlotIndex?: number;
  /** Schema-compatible address into the render-ui tree (`root`, `root.children.0`, …) — the exact `patternPath` `schemaEditor.movePattern`/`removePattern`/`updatePatternProp` expect. */
  patternPath?: string;
}

/**
 * Parses any id `schemaToLayerItems` produces back into its typed segments.
 * Returns `null` for a malformed id (missing/garbled `orbital:` root, or an
 * unrecognized segment). Segments below the deepest one present in `id` are
 * left `undefined` — e.g. a trait-level id has no `slotName`/`patternPath`.
 */
export function parseLayerId(id: string): LayerIdParts | null {
  const [head, ...rest] = id.split('/');
  const orbitalMatch = /^orbital:(.+)$/.exec(head ?? '');
  if (!orbitalMatch) return null;

  const parts: LayerIdParts = { orbitalName: orbitalMatch[1] };

  for (const segment of rest) {
    const pageMatch = /^page:(.+)$/.exec(segment);
    if (pageMatch) {
      parts.pageName = pageMatch[1];
      continue;
    }
    const traitMatch = /^trait:(.+)$/.exec(segment);
    if (traitMatch) {
      parts.traitName = traitMatch[1];
      continue;
    }
    const transitionMatch = /^transition:(\d+)$/.exec(segment);
    if (transitionMatch) {
      parts.transitionIndex = Number(transitionMatch[1]);
      continue;
    }
    const slotMatch = /^slot:(.+)$/.exec(segment);
    if (slotMatch) {
      parts.slotName = slotMatch[1];
      continue;
    }
    const patternMatch = /^pattern:(\d+):(.+)$/.exec(segment);
    if (patternMatch) {
      parts.patternSlotIndex = Number(patternMatch[1]);
      parts.patternPath = patternMatch[2];
      continue;
    }
    return null;
  }

  return parts;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface LayersPanelProps {
  schema: OrbitalSchema;
  /** Currently selected node id (any level of the ID scheme above). */
  selectedId?: string;
  onSelect?: (id: string) => void;
  /**
   * Reorder a node within the tree. Threaded to FileTree's `onNodeReorder`
   * seam — presence-gated there, so omitting it just means no dragging.
   */
  onReorder?: (id: string, newParentId: string | null, index: number) => void;
}

export const LayersPanel: React.FC<LayersPanelProps> = ({ schema, selectedId, onSelect, onReorder }) => {
  const items = useMemo(() => schemaToLayerItems(schema), [schema]);

  return (
    <FileTree
      items={items}
      look="nav"
      selectedId={selectedId}
      onNodeSelect={onSelect}
      onNodeReorder={onReorder}
    />
  );
};

LayersPanel.displayName = 'LayersPanel';
