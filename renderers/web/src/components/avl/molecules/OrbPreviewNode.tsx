'use client';

/**
 * OrbPreviewNode
 *
 * React Flow node that renders a real OrbPreview inside it.
 * The canvas is always live and editable (like Figma). Clicking any
 * rendered UI element selects its pattern and shows props in the
 * TransitionPanel. No edit mode toggle needed.
 *
 * The header is the drag handle for React Flow. The content area
 * passes clicks through to the pattern elements.
 */

import React, { useMemo, useState, useCallback, useContext, createContext, useRef, useEffect } from 'react';
import { Handle, NodeResizeControl, Position, ResizeControlVariant, useReactFlow, type NodeProps } from '@xyflow/react';
import type { OrbitalSchema, OrbitalDefinition, Trait, Transition, Effect, EntityData, EntityRow, EventPayloadField, TraitEventContract, EventPayload, EventPayloadValue, PageRef } from '@almadar/core';
import { isInlineTrait, isPageReference } from '@almadar/core';
import type { EditFocus, EntityRef, TraitRef } from '@almadar/core';
import { collectEmbeddedTraits } from '../../../lib/embedded-traits';

import { CANVAS_TOOLS, hasCanvasTool, type CanvasTool } from '../../../lib/canvas-tools';
import { avlTint } from '../../../lib/avl-theme';

function entityNameOf(ref: EntityRef | undefined): string | undefined {
  if (!ref) return undefined;
  if (typeof ref === 'string') return ref;
  return 'name' in ref ? ref.name : undefined;
}
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { Icon } from '../../../core';
import { Select } from '../../../core';
import { IconButton } from '../../core/molecules/IconButton';
import { Badge } from '../../../core';
import { LIVE_STATE, type CanvasStateOptions } from '../../../lib/avl-preview-converter';
import { resolvePatternConfig, patternNodeAt, parseClipboardPatterns, PATTERN_CLIPBOARD_TYPE } from '../../../lib/resolve-pattern-config';
import { isEditableTarget } from '../../../lib/keyMapEvent';
import { useInlineTextEdit } from '../../../hooks/useInlineTextEdit';
import { DesignSelectionOverlay } from './DesignSelectionOverlay';
import { axisPositionFrom, distanceLines, insertionLineRect, layoutBoxOf, marqueeHits, marqueeRect, offsetWithin, renderedAlignment, renderedSpacing, snapMove, spacingScaleOf, type GuideLine, type MeasureLine, type OffsetInParent, type OverlayRect } from '../../../lib/selection-geometry';
import { DesignGuidesOverlay } from './DesignGuidesOverlay';
import { OrbPreview } from '../../../preview/OrbPreview';
import { avlSeries } from '../../../lib/avl-theme';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { usePrefersReducedMotion } from '../../../core';
import {
  useCanvasDroppable,
  useCanvasDraggable,
  type CanvasDropTarget,
  type CanvasContainerNode,
} from '../../../hooks/useCanvasDnd';
import { formatPayloadTooltip } from '../../../lib/wire-validation';
import { deriveEditFocusFromElement, traitOfElement, withNodeTransition } from '../../../lib/derive-edit-focus';
import { ElementEditAccessContext, propAccessAt } from '../../../lib/element-edit-access';
import { computeInsertionIndex, type DOMRectLike, type InsertionAxis } from '../../../lib/compute-insertion-index';
import { directPatternChildren, resolveDirectChildren } from '../../../lib/resolve-direct-children';
import { createLogger } from '@almadar/logger';
import { type SpacingStepPx, positionOf, withPosition } from '../../../lib/design-classes';
import { type PreviewNodeData, type PatternEventSource, type ScreenSize, SCREEN_SIZE_PRESETS } from '../../../lib/avl-preview-converter';
import { STATE_COLORS, CONNECTION_COLORS, type StateRole } from '../../../lib/avl-theme';

const eventHandleLog = createLogger('almadar:ui:nan-coord');
const orbPreviewLog = createLogger('almadar:ui:orb-preview-node');

// AVL canvas wire check: log module-init so we can confirm OrbPreviewNode
// actually finished defining before FlowCanvas's NODE_TYPES picks it up.
// If this never fires but FlowCanvas's `node-type-registry` log does, the
// import order is wrong and `preview` lands `undefined` in the registry.
orbPreviewLog.debug('module-init', () => ({ orbPreview: typeof OrbPreview }));

// ---------------------------------------------------------------------------
// Contexts (provided by FlowCanvas)
// ---------------------------------------------------------------------------

export const ScreenSizeContext = createContext<ScreenSize>('tablet');

const CARD_MIN_WIDTH = 240;
const CARD_MAX_WIDTH = 1600;

/** Selected pattern info, emitted when user clicks a UI element in the node. */
export interface SelectedPattern {
  /** The pattern type (e.g., "button", "input", "stack"). */
  patternType: string;
  /** The DOM element's data-pattern-id if available. */
  patternId?: string;
  /** The node this pattern belongs to. */
  nodeData: PreviewNodeData;
  /** The source trait for this slot content. */
  sourceTrait?: string;
  /** Bounding rect relative to the node for floating inspector positioning. */
  rect?: { top: number; left: number; width: number; height: number };
  /** Every selected pattern path in this node (multi-select), this one — the primary — last. */
  selection?: string[];
  /** Its distances from its parent's four sides and the parent's size (card px), when it has a parent pattern. */
  offsetInParent?: OffsetInParent;
  /** The element's own address — the trait that drew it (an embedded trait's, not the card's), transition, slot, path. */
  focus?: EditFocus;
  /** Every selected element's own address (multi-select), the primary last — `selection` repeats paths across embedded traits. */
  elements?: EditFocus[];
}

export const PatternSelectionContext = createContext<{
  selected: SelectedPattern | null;
  select: (pattern: SelectedPattern | null) => void;
}>({ selected: null, select: () => {} });

/** The canvas editing tools the host turned on (a persona's shell manifest declares them); all by default. */
export const CanvasToolsContext = createContext<readonly CanvasTool[]>(CANVAS_TOOLS);

/** The state dropdown each orbital card shows in its header (FlowCanvas provides it). */
export interface CanvasStatePicker {
  optionsOf: (orbital: string) => CanvasStateOptions;
  chosen: (orbital: string) => string;
  choose: (orbital: string, stateId: string) => void;
}

export const CanvasStatePickerContext = createContext<CanvasStatePicker | null>(null);

/** A trait's latest verification verdict, as the host keeps it. */
export interface CardVerdict {
  status: 'pass' | 'fail' | 'stale' | 'running';
  detail?: string;
}

/**
 * A host that verifies from the canvas (Studio's Designer): each card shows controls to verify
 * the transition it shows (`UI:CARD_VERIFY_STEP`) or its trait's whole walk
 * (`UI:CARD_VERIFY_TRAIT`, paused and stopped with `UI:CARD_VERIFY_PAUSE` / `_STOP`), and the
 * trait's verdict. Absent: no verify controls.
 */
export interface CanvasVerify {
  verdictOf: (orbital: string, trait: string) => CardVerdict | undefined;
  playing: (orbital: string) => boolean;
}

export const CanvasVerifyContext = createContext<CanvasVerify | null>(null);

const VERDICT_VARIANT: Record<CardVerdict['status'], 'success' | 'error' | 'warning' | 'info'> = {
  pass: 'success',
  fail: 'error',
  stale: 'warning',
  running: 'info',
};

/**
 * `useCanvasDraggable`'s `'pattern-instance'` payload data (see
 * `useCanvasDnd.tsx`). `[key: string]: EventPayloadValue` mirrors
 * `CanvasContainerNode`'s own index signature — required to structurally
 * match `EventPayload` when handed to `useCanvasDraggable`.
 */
interface PatternInstanceDragData {
  fromPath: string;
  loc: CanvasContainerNode;
  [key: string]: EventPayloadValue;
}

// ---------------------------------------------------------------------------
// State role colors
// ---------------------------------------------------------------------------

// Read at render: `STATE_COLORS` lives in another module, and the split dist chunks
// do not guarantee it is initialised when this module is.
function roleColors(role: StateRole): { border: string; dot: string } {
  if (role === 'default') return { border: 'var(--color-border)', dot: STATE_COLORS.default.border };
  return { border: STATE_COLORS[role].border, dot: STATE_COLORS[role].border };
}

const LAYER_ORDER = ['Infrastructure', 'Services', 'UI Patterns', 'Game', 'ML', 'Domain', 'Community'] as const;
const LAYER_LABEL_KEYS: Record<string, string> = {
  Infrastructure: 'orbPreview.layer.infrastructure',
  Services: 'orbPreview.layer.services',
  'UI Patterns': 'orbPreview.layer.uiPatterns',
  Game: 'orbPreview.layer.game',
  ML: 'orbPreview.layer.ml',
  Domain: 'orbPreview.layer.domain',
  Community: 'orbPreview.layer.community',
};
let layerColors: Record<string, string> | undefined;
// Built on first use: avlSeries reads THEME_SERIES, which another chunk may not have evaluated yet at module load.
const layerColorOf = (layer: string): string | undefined => {
  layerColors ??= Object.fromEntries(LAYER_ORDER.map((name, i) => [name, avlSeries(i)]));
  return layerColors[layer];
};

// ---------------------------------------------------------------------------
// Handle styles
// ---------------------------------------------------------------------------

const TARGET_HANDLE_STYLE: React.CSSProperties = {
  background: 'var(--color-primary)',
  width: 8,
  height: 8,
  border: '2px solid var(--color-card)',
};

function eventHandleStyle(source: PatternEventSource): React.CSSProperties {
  const hint = Number.isFinite(source.positionHint) ? source.positionHint : 0.5;
  if (hint !== source.positionHint) {
    eventHandleLog.warn('orb-preview-handle: non-finite positionHint on PatternEventSource', {
      event: source.event,
      patternType: source.patternType,
      label: source.label,
      positionHint: source.positionHint,
    });
  }
  return {
    background: CONNECTION_COLORS.emitListen.color,
    width: 10,
    height: 10,
    border: '2px solid var(--color-card)',
    top: `${hint * 100}%`,
    right: -5,
  };
}

// ---------------------------------------------------------------------------
// Schema builders for OrbPreview
// ---------------------------------------------------------------------------

function buildOrbitalSchema(
  fullSchema: OrbitalSchema,
  orbitalName: string,
): OrbitalSchema {
  const orbital = (fullSchema.orbitals ?? []).find((o: OrbitalDefinition) => o.name === orbitalName);
  if (!orbital) return fullSchema;
  return { ...fullSchema, name: `${fullSchema.name}__${orbitalName}`, orbitals: [orbital] };
}

/**
 * The L2 transition card synthesizes a one-state state machine that fires INIT
 * with the target transition's render-ui effects. But render-ui props bind
 * `@payload.<X>` — values normally carried by the triggering event. With an
 * auto-INIT and no payload, those bindings resolve to undefined and the
 * preview is empty. We rebuild a representative payload from the trait's
 * declared `emits[<event>].payloadSchema` (every std-14 emit has one), then
 * substitute every `@payload.<path>` reference in the cloned effects.
 */

function generateMockPayload(
  payloadSchema: EventPayloadField[] | undefined,
  schema: OrbitalSchema,
  linkedEntity: string | undefined,
  mockData: EntityData | undefined,
): EventPayload {
  const payload: EventPayload = {};
  if (!payloadSchema || payloadSchema.length === 0) return payload;

  const entityNames = new Set<string>();
  for (const orb of schema.orbitals ?? []) {
    const name = entityNameOf(orb.entity);
    if (name) entityNames.add(name);
  }
  const linkedRows: EntityRow[] = linkedEntity
    ? mockData?.[linkedEntity] ?? []
    : [];
  const linkedFirstRow: EntityRow | undefined = linkedRows[0];

  const valueForType = (rawType: string, entityType?: string): EventPayloadValue | undefined => {
    const type = rawType.replace(/!$/, '').trim();
    const arrayMatch = /^\[\s*(\w+)\s*\]$/.exec(type);
    if (arrayMatch) {
      // [X] → rows for X. Fall back to linkedEntity rows when the resolver
      // hasn't rewritten the atom's original entity name (e.g. `[BrowseItem]`
      // surviving on a Channel-bound trait).
      return mockData?.[arrayMatch[1]] ?? linkedRows;
    }
    if (type === 'array') return linkedRows;
    if (type === 'entity') {
      const target = entityType && mockData?.[entityType] ? entityType : linkedEntity;
      return (target && mockData?.[target]?.[0]) ?? linkedFirstRow ?? {};
    }
    if (entityNames.has(type)) {
      return mockData?.[type]?.[0] ?? linkedFirstRow ?? {};
    }
    switch (type) {
      case 'string': return 'Sample';
      case 'number': return 1;
      case 'boolean': return false;
      case 'object': return {};
      case 'date':
      case 'datetime':
      case 'timestamp': return new Date().toISOString();
      default: return undefined;
    }
  };

  const setByPath = (target: EventPayload, path: string, value: EventPayloadValue): void => {
    const parts = path.split('.');
    let cur: EventPayload = target;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      const next = cur[k];
      if (next === null || typeof next !== 'object' || Array.isArray(next)) {
        cur[k] = {};
      }
      // After the assignment above, cur[k] is an EventPayload object.
      cur = cur[k] as EventPayload;
    }
    cur[parts[parts.length - 1]] = value;
  };

  for (const field of payloadSchema) {
    let value = valueForType(field.type, field.entity);
    // For path-style fields (e.g. `row.id`) whose declared type is a
    // primitive, prefer the matching value off the linked entity's first row
    // so the preview shows real, consistent data instead of "Sample".
    if (
      linkedFirstRow !== undefined &&
      field.name.includes('.') &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    ) {
      const tail = field.name.split('.').pop()!;
      const fromRow = linkedFirstRow[tail];
      if (fromRow !== undefined) value = fromRow;
    }
    if (value !== undefined) setByPath(payload, field.name, value);
  }
  return payload;
}

function substitutePayloadBindings(
  effects: Effect[],
  payload: EventPayload,
): Effect[] {
  const isPayloadObject = (v: EventPayloadValue | undefined): v is EventPayload =>
    v !== null && typeof v === 'object' && !Array.isArray(v);
  const getByPath = (path: string): EventPayloadValue | undefined => {
    let cur: EventPayloadValue | undefined = payload;
    for (const k of path.split('.')) {
      if (!isPayloadObject(cur)) return undefined;
      cur = cur[k];
    }
    return cur;
  };
  const replaceValue = (v: EventPayloadValue): EventPayloadValue => {
    if (typeof v === 'string' && v.startsWith('@payload.')) {
      const resolved = getByPath(v.slice('@payload.'.length));
      // Leave the literal in place when a field is missing from the schema —
      // the runtime's existing resolver will treat it as undefined like
      // before, so we never fabricate values for un-declared paths.
      return resolved === undefined ? v : resolved;
    }
    if (Array.isArray(v)) return v.map(replaceValue);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out: EventPayload = {};
      for (const [k, inner] of Object.entries(v)) {
        out[k] = replaceValue(inner);
      }
      return out;
    }
    return v;
  };
  // Effects are JSON-serialisable trees of strings, numbers, booleans, arrays
  // and objects — structurally a subset of EventPayloadValue, the canonical
  // recursive JSON shape from @almadar/core. Round-trip via JSON to obtain a
  // typed view, substitute, then narrow back to Effect on the way out.
  const tree: EventPayloadValue = JSON.parse(JSON.stringify(effects)) as EventPayloadValue;
  const substituted = replaceValue(tree);
  return substituted as Effect[];
}

function findEmitContract(trait: Trait, event: string): TraitEventContract | undefined {
  return trait.emits?.find((e) => e.event === event);
}

/** Paths restart at each embedded trait's root: an element is its path within the trait that drew it. */
function elementIn(container: Element | null | undefined, path: string, trait: string | undefined): HTMLElement | null {
  const candidates = Array.from(container?.querySelectorAll(`[data-pattern-path="${CSS.escape(path)}"]`) ?? []);
  const el = candidates.find((c) => trait === undefined || traitOfElement(c) === trait);
  return el instanceof HTMLElement ? el : null;
}

function sameElement(a: EditFocus, b: EditFocus): boolean {
  return a.trait === b.trait && a.path === b.path;
}

type DropContainer = { orbital: string; trait: string; transition: string; slot: string; path: string };

/** The address a structure edit carries, when the element has a complete one. */
function elementAddressOf(focus: EditFocus): DropContainer | null {
  const { orbital, trait, transition, slot, path } = focus;
  return trait && transition !== undefined && slot && path ? { orbital, trait, transition, slot, path } : null;
}

/**
 * The topmost rendered element under a point inside `content`: the canvas's
 * own chrome drawn over the render (selection frame, handles, badges) is
 * looked through, so a drop onto a selected element resolves into the render
 * beneath it, not the card's dead space.
 */
function renderedElementAt(content: HTMLElement | null, point: { x: number; y: number }): HTMLElement | null {
  const stack = document.elementsFromPoint(point.x, point.y);
  const rendered = stack.find((el): el is HTMLElement => el instanceof HTMLElement && content?.contains(el) === true && el.closest('[data-pattern-path]') !== null);
  if (rendered) return rendered;
  const top = stack[0];
  return top instanceof HTMLElement ? top : null;
}

/** `traitName` and every trait it embeds, transitively (the runtime's own `@trait.X` scan). */
function embeddedClosure(traits: ReadonlyArray<TraitRef>, traitName: string): Set<string> {
  const byName = new Map(traits.flatMap((t): Array<[string, TraitRef]> => (typeof t !== 'string' && 'name' in t && t.name ? [[t.name, t]] : [])));
  const kept = new Set([traitName]);
  let frontier = [traitName];
  while (frontier.length > 0) {
    const scan = frontier.flatMap((n) => { const t = byName.get(n); return t ? [t] : []; });
    const refs = collectEmbeddedTraits({ name: 'closure', orbitals: [{ name: 'closure', entity: { name: 'closure', fields: [] }, traits: scan, pages: [] }] });
    frontier = [...refs].filter((n) => byName.has(n) && !kept.has(n));
    frontier.forEach((n) => kept.add(n));
  }
  return kept;
}

function buildTransitionSchema(
  fullSchema: OrbitalSchema,
  orbitalName: string,
  traitName: string,
  transitionEvent: string,
  fromState: string | undefined,
  toState: string | undefined,
  mockData: EntityData | undefined,
): OrbitalSchema {
  const orbital = (fullSchema.orbitals ?? []).find((o: OrbitalDefinition) => o.name === orbitalName);
  if (!orbital) return fullSchema;

  const clonedOrbital: OrbitalDefinition = JSON.parse(JSON.stringify(orbital));

  const traits = clonedOrbital.traits ?? [];
  for (let ti = 0; ti < traits.length; ti++) {
    const trait = traits[ti];
    if (!isInlineTrait(trait)) continue;
    const traitObj: Trait = trait;
    if (traitObj.name !== traitName) continue;

    const sm = traitObj.stateMachine;
    if (!sm) continue;

    const allTransitions: Transition[] = sm.transitions ?? [];
    const targetTransition = fromState && toState
      ? allTransitions.find(t => t.event === transitionEvent && t.from === fromState && t.to === toState)
        ?? allTransitions.find(t => t.event === transitionEvent)
      : allTransitions.find(t => t.event === transitionEvent);
    if (!targetTransition?.effects) continue;

    // STUDIO-2: keep `["set", "@entity.X", ...]` effects so render-ui
    // expressions reading those bindings resolve against the trait's
    // own authored data (e.g. std-stats' DefaultKpiStats sets
    // `@entity.cards` to a literal array of stat objects before its
    // render-ui consumes them). Without this the L2 grouped cards
    // render their `render-ui` against undefined bindings and show
    // empty placeholders ("No items" / "No data available").
    //
    // Side effects that mutate external state (persist, call-service,
    // fetch, emit) are still stripped — the L2 card is a sandbox.
    const previewEffects: Effect[] = [];
    let hasRenderUI = false;
    for (const eff of targetTransition.effects) {
      if (!Array.isArray(eff)) continue;
      const op = eff[0];
      if (op === 'render-ui') {
        // L2 transition cards preview the screen the user will see when
        // this transition fires. The runtime's portal slots (modal,
        // drawer, overlay, center) render with `absolute inset-0` chrome
        // that's tied to the host page's viewport — useful in a real
        // app, useless in a card preview where there's no "page" to
        // overlay. Worse, absolute children don't contribute to their
        // parent's height, so the card can't auto-fit content the way
        // L1 orbital cards do; it stays whatever fixed height we
        // pinned it to, with empty space under tiny modals and
        // overflow scroll on tall ones. Rewrite portal slots to
        // `main` so the rendered pattern lands inline in the L2 card's
        // main slot — content drives card height, just like L1.
        const slotTarget = eff[1];
        const PORTAL_SLOTS = new Set(['modal', 'drawer', 'overlay', 'center']);
        const rewritten: Effect = (typeof slotTarget === 'string' && PORTAL_SLOTS.has(slotTarget))
          ? (['render-ui', 'main', ...eff.slice(2)] as Effect)
          : eff;
        previewEffects.push(rewritten);
        hasRenderUI = true;
        continue;
      }
      if (op === 'set') {
        // Only preserve `set @entity.*` writes. `set @memory.*` etc.
        // are global state we shouldn't pollute from a preview.
        const target = eff[1];
        if (typeof target === 'string' && target.startsWith('@entity.')) {
          previewEffects.push(eff);
        }
      }
    }

    if (!hasRenderUI) continue;

    const linkedEntity = traitObj.linkedEntity ?? entityNameOf(clonedOrbital.entity);
    const emitContract = findEmitContract(traitObj, transitionEvent);
    const mockPayload = generateMockPayload(
      emitContract?.payloadSchema,
      fullSchema,
      linkedEntity,
      mockData,
    );
    const seededEffects = substitutePayloadBindings(previewEffects, mockPayload);

    traitObj.stateMachine = {
      states: [{ name: 'preview', isInitial: true }],
      events: [{ key: 'INIT', name: 'INIT' }],
      transitions: [{ from: 'preview', to: 'preview', event: 'INIT', effects: seededEffects }],
    };
    traitObj.emits = [];
    traitObj.listens = [];
    break;
  }

  const targetTrait = traits.find((t) => {
    if (typeof t === 'string') return t === traitName;
    if ('name' in t) return t.name === traitName;
    if ('ref' in t) return t.ref === traitName;
    return false;
  });
  // Keep the traits the card embeds (`@trait.X`, transitively): a real
  // screen is mostly embedded behaviors, whose frames render from their own
  // traits. Everything else on the orbital is dropped.
  const kept = targetTrait ? embeddedClosure(traits, traitName) : new Set<string>();
  if (targetTrait) {
    clonedOrbital.traits = traits.filter((t) => typeof t !== 'string' && 'name' in t && t.name !== undefined && kept.has(t.name));
  }

  // Filter pages to reference ONLY the target trait. Without this the
  // synthesized schema's pages still list the original 7+ trait names
  // (ProductAppLayout, ProductCatalog, …) but `clonedOrbital.traits` was
  // just narrowed to the target — `useResolvedSchema`'s page-binding
  // resolution then drops or fails on the missing refs, and the
  // `traitLinkedEntitiesMap` SchemaRunner builds from page bindings ends
  // up empty (or missing our target). UISlotRenderer's form-section
  // enrichment is gated on `entityDef` resolved via that map, so
  // `fields: ["name", "price", …]` stays as raw strings and Form renders
  // no inputs. Restricting pages.traits[] to the target restores the
  // page → trait → entity chain the form needs.
  //
  // Each surviving binding gets an explicit `linkedEntity` so the chain
  // resolves cleanly even when the original page binding relied on the
  // trait's own `linkedEntity` declaration.
  if (Array.isArray(clonedOrbital.pages)) {
    const linkedEntityForTrait =
      isInlineTrait(targetTrait as Trait)
        ? (targetTrait as Trait).linkedEntity ?? entityNameOf(clonedOrbital.entity)
        : entityNameOf(clonedOrbital.entity);
    clonedOrbital.pages = clonedOrbital.pages
      .map((page: PageRef): PageRef => {
        // String refs and PageRefObject refs point to imported pages
        // we can't introspect here — leave them as-is so the resolver
        // either follows the import or skips them gracefully.
        if (isPageReference(page)) return page;
        const inline = page;
        if (!Array.isArray(inline.traits)) return inline;
        const filteredTraits = inline.traits
          .filter((t) => kept.has(t.ref))
          .map((t) => (t.ref === traitName ? { ...t, linkedEntity: t.linkedEntity ?? linkedEntityForTrait } : t));
        return { ...inline, traits: filteredTraits };
      })
      .filter((page: PageRef): boolean => {
        if (isPageReference(page)) return true;
        return Array.isArray(page.traits) && page.traits.length > 0;
      });
  }

  return { ...fullSchema, name: `${fullSchema.name}__${orbitalName}__${traitName}__${transitionEvent}`, orbitals: [clonedOrbital] };
}

// ---------------------------------------------------------------------------
// Selection highlight styles (injected once)
// ---------------------------------------------------------------------------

// NOTE: hover/selection outlines are NOT done with CSS `outline` on
// `[data-pattern]`. Those wrappers are `display:contents` (no generated box),
// so `outline` paints nothing and `getBoundingClientRect()` is 0×0. The
// visible highlight is a JS-positioned overlay (see component) sized to the
// union of the wrapper's rendered children. CSS here only sets the cursor.
const SELECTION_STYLES = `
  .orb-preview-live [data-pattern] {
    cursor: pointer;
  }
  .orb-preview-live.drag-active [data-accepts-children="true"] {
    outline: 2px dashed var(--color-primary);
    outline-offset: -2px;
    transition: outline-color 0.15s, background-color 0.15s;
  }
  .orb-preview-live.drag-active [data-accepts-children="true"].drag-hover {
    outline-color: var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 5%, transparent);
  }
  .orb-preview-live .drop-indicator {
    height: 2px;
    background: var(--color-primary);
    border-radius: 1px;
    pointer-events: none;
  }
`;

// ---------------------------------------------------------------------------
// Selection / hover overlay geometry
// ---------------------------------------------------------------------------

interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Absolute (viewport) union box of `el`. A `[data-pattern]` wrapper is
 * `display:contents`, so its own `getBoundingClientRect()` is 0×0 — we union
 * its rendered descendants' boxes instead (recursing through any nested
 * contents wrappers) to get the real painted bounds.
 */
function absUnion(el: Element): { top: number; left: number; right: number; bottom: number } | null {
  const own = el.getBoundingClientRect();
  if (own.width > 0 || own.height > 0) {
    return { top: own.top, left: own.left, right: own.right, bottom: own.bottom };
  }
  let r: { top: number; left: number; right: number; bottom: number } | null = null;
  for (const child of Array.from(el.children)) {
    const box = absUnion(child);
    if (!box) continue;
    r = r
      ? {
          top: Math.min(r.top, box.top),
          left: Math.min(r.left, box.left),
          right: Math.max(r.right, box.right),
          bottom: Math.max(r.bottom, box.bottom),
        }
      : box;
  }
  return r;
}

/**
 * `el`'s painted bounds in `container`'s LOCAL (pre-transform) coordinate
 * space. getBoundingClientRect returns SCREEN px — and this node lives inside
 * ReactFlow's zoom/pan CSS transform — so the screen-space delta is divided by
 * `zoom` to undo the transform. The overlay (a child of the same transformed
 * container) is then re-scaled by ReactFlow to land exactly on the element.
 */
/** `root.children.2` → parent `root`, index 2; the root has no position. */
function childPosition(path: string): { parentPath: string; index: number } | null {
  const match = /^(.*)\.children\.(\d+)$/.exec(path);
  return match ? { parentPath: match[1], index: Number(match[2]) } : null;
}

interface InsertionTarget {
  parentPath: string;
  index: number;
  /** The container element's own address (the trait that drew it — an embedded behavior's, not the card's). */
  container: DropContainer | null;
  containerBox: DOMRectLike;
  childRects: DOMRectLike[];
  axis: InsertionAxis;
}

interface SelectedLayout {
  axis: InsertionAxis;
  alignment: ReturnType<typeof renderedAlignment>;
  spacing: ReturnType<typeof renderedSpacing>;
  childRects: RectLike[];
}

/** A layout container's flow direction and its direct children's boxes; null for anything else. */
function measureLayout(el: Element, container: Element, zoom: number): SelectedLayout | null {
  if (el.getAttribute('data-accepts-children') !== 'true') return null;
  const path = el.getAttribute('data-pattern-path') ?? 'root';
  const children = resolveDirectChildren(
    path,
    Array.from(el.querySelectorAll('[data-pattern-path]')).map((child) => ({
      path: child.getAttribute('data-pattern-path') ?? '',
      ref: child,
    })),
  );
  const childRects = children
    .map((child) => rectRelativeTo(child, container, zoom))
    .filter((r): r is RectLike => r !== null);
  const axis = resolveLayoutAxis(el);
  const style = getComputedStyle(layoutBoxOf(el));
  return { axis, alignment: renderedAlignment(style), spacing: renderedSpacing(style, axis), childRects };
}

function rectRelativeTo(el: Element, container: Element, zoom: number): RectLike | null {
  const u = absUnion(el);
  if (!u) return null;
  const base = container.getBoundingClientRect();
  const z = zoom > 0 ? zoom : 1;
  return {
    top: (u.top - base.top) / z,
    left: (u.left - base.left) / z,
    width: (u.right - u.left) / z,
    height: (u.bottom - u.top) / z,
  };
}

/**
 * Where an element sits in its parent pattern, as an absolute child would be
 * placed: against the parent's padding box (inside its border). Undefined for
 * the root, which has no parent pattern.
 */
function offsetInParentOf(el: Element, rect: RectLike | null, container: Element, zoom: number): OffsetInParent | undefined {
  const parent = rect ? parentBoxOf(el, container, zoom) : null;
  return rect && parent ? offsetWithin(rect, parent.box) : undefined;
}

/** The parent pattern of `el` and its padding box (what an absolute child is placed against), in content coordinates. */
function parentBoxOf(el: Element, container: Element, zoom: number): { el: Element; box: RectLike } | null {
  const parentPattern = el.parentElement?.closest('[data-pattern-path]');
  if (!parentPattern || !container.contains(parentPattern)) return null;
  const box = layoutBoxOf(parentPattern);
  if (!(box instanceof HTMLElement)) return null;
  const z = zoom > 0 ? zoom : 1;
  const b = box.getBoundingClientRect();
  const base = container.getBoundingClientRect();
  return {
    el: parentPattern,
    box: {
      top: (b.top - base.top) / z + box.clientTop,
      left: (b.left - base.left) / z + box.clientLeft,
      width: box.clientWidth,
      height: box.clientHeight,
    },
  };
}

/** Flow direction of a container, read from the element that lays it out. */
function resolveLayoutAxis(el: Element): InsertionAxis {
  return getComputedStyle(layoutBoxOf(el)).flexDirection === 'row' ? 'horizontal' : 'vertical';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const OrbPreviewNodeInner: React.FC<NodeProps> = (props) => {
  const data = props.data as PreviewNodeData;
  const screenSize = useContext(ScreenSizeContext);
  const preset = SCREEN_SIZE_PRESETS[screenSize];
  const { select } = useContext(PatternSelectionContext);
  const { t } = useTranslate();
  const eventBus = useEventBus();
  const reactFlow = useReactFlow();
  const cameraMs = usePrefersReducedMotion() ? 0 : 200;
  const contentRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  // Paused by default: an edit surface first. While paused the card's ticks
  // stop and clicks select elements instead of driving its trait machine.
  const [playing, setPlaying] = useState(false);
  const tools = useContext(CanvasToolsContext);
  // Multi-select: every selected path (primary last), the others' outlines, and a marquee in progress.
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [selectedFocuses, setSelectedFocuses] = useState<EditFocus[]>([]);
  const [extraRects, setExtraRects] = useState<RectLike[]>([]);
  const [marquee, setMarquee] = useState<OverlayRect | null>(null);
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [measures, setMeasures] = useState<MeasureLine[]>([]);
  const suppressClickRef = useRef(false);
  const togglePlaying = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPlaying((p) => !p);
  }, []);
  const handleMouseEnter = useCallback(() => setHovered(true), []);
  const handleMouseLeave = useCallback(() => setHovered(false), []);

  // Contextual-edit selection/hover overlays (sized to the union of the
  // clicked/hovered element's rendered children; see rectRelativeTo).
  const [selectedRect, setSelectedRect] = useState<RectLike | null>(null);
  // The selected element's address in the render-ui tree, for edits made on the canvas.
  const [selectedAddress, setSelectedAddress] = useState<{ patternId: string; patternType: string; focus: EditFocus | null } | null>(null);
  // The selected element's layout (when it is a layout container), for spacing handles.
  const [selectedLayout, setSelectedLayout] = useState<SelectedLayout | null>(null);
  // What each spacing step renders at on the selection (its theme's --space-N tokens).
  const [selectedScale, setSelectedScale] = useState<SpacingStepPx | undefined>(undefined);
  const [hoverRect, setHoverRect] = useState<RectLike | null>(null);
  const lastHoverElRef = useRef<Element | null>(null);

  const role = data.stateRole ?? 'default';
  const colors = roleColors(role);
  const eventSources = data.eventSources ?? [];
  const layerColor = data.layer ? layerColorOf(data.layer) : undefined;

  const isExpanded = Boolean(data.traitName);
  const status = data.status ?? 'idle';
  const isRunning = status === 'running';
  const isSuccess = status === 'success';
  const isError = status === 'error';
  const statePicker = useContext(CanvasStatePickerContext);
  const verify = useContext(CanvasVerifyContext);
  const stateOptions = useMemo(() => {
    if (!statePicker || data.kind === 'trait-card') return null;
    const { own, groups } = statePicker.optionsOf(data.orbitalName);
    return {
      options: [{ value: LIVE_STATE, label: t('canvas.liveState') }, ...own.map((o) => ({ value: o.id, label: o.label }))],
      groups: groups.map((g) => ({ label: `${g.alias} · ${g.behaviorName}`, options: g.options.map((o) => ({ value: o.id, label: o.label })) })),
    };
  }, [statePicker, data.orbitalName, data.kind, t]);
  const shownStep = useMemo(() => {
    if (!verify || !statePicker || data.kind === 'trait-card') return null;
    const { own, groups } = statePicker.optionsOf(data.orbitalName);
    const chosen = statePicker.chosen(data.orbitalName);
    const option = [...own, ...groups.flatMap((g) => g.options)].find((o) => o.id === chosen);
    const trait = option?.data.traitName;
    if (!option || !trait) return null;
    return { trait, event: option.data.transitionEvent ?? '', from: option.data.fromState ?? '' };
  }, [verify, statePicker, data.orbitalName, data.kind]);
  const verdict = shownStep ? verify?.verdictOf(data.orbitalName, shownStep.trait) : undefined;
  const verifyPlaying = verify?.playing(data.orbitalName) ?? false;
  const sublabel = data.entityName ?? '';

  const orbitalSchema = useMemo(() => {
    const fullSchema = data._fullSchema as OrbitalSchema | undefined;
    if (!fullSchema) return undefined;

    if (isExpanded && data.traitName && data.transitionEvent) {
      return buildTransitionSchema(
        fullSchema,
        data.orbitalName,
        data.traitName,
        data.transitionEvent,
        data.fromState as string | undefined,
        data.toState as string | undefined,
        data._mockData as EntityData | undefined,
      );
    }

    return buildOrbitalSchema(fullSchema, data.orbitalName);
  }, [data._fullSchema, data._mockData, data.orbitalName, data.traitName, data.transitionEvent, data.fromState, data.toState, isExpanded]);

  // Click delegation: find the closest [data-pattern] ancestor of the click target
  // Select one rendered pattern element (or clear the selection with null) —
  // shared by clicks and keyboard navigation.
  const focusOfElement = useCallback((el: HTMLElement): EditFocus | null => {
    const derived = deriveEditFocusFromElement(el);
    return derived ? withNodeTransition(derived, data) : null;
  }, [data]);

  // `selection`: every selected element, the primary last (multi-select).
  const selectPatternElement = useCallback((patternEl: HTMLElement | null, selection?: HTMLElement[]) => {
    const container = contentRef.current;

    // Clear previous selection highlights
    container?.querySelectorAll('.pattern-selected').forEach(el => {
      el.classList.remove('pattern-selected');
    });

    const zoom = reactFlow.getViewport().zoom;
    if (patternEl && container) {
      patternEl.classList.add('pattern-selected');
      // Union of rendered children — the wrapper itself is display:contents
      // (0×0 own rect), so its own getBoundingClientRect is useless.
      const rect = rectRelativeTo(patternEl, container, zoom);
      setSelectedRect(rect);
      setSelectedLayout(measureLayout(patternEl, container, zoom));
      setSelectedScale(() => spacingScaleOf(layoutBoxOf(patternEl)));
      const primaryPath = patternEl.getAttribute('data-pattern-path') ?? 'root';
      // The element's own address: the trait that drew it (an embedded
      // trait's, not the card's), its transition, slot and path.
      const focus = focusOfElement(patternEl);
      setSelectedAddress({
        patternId: primaryPath,
        patternType: patternEl.getAttribute('data-pattern') ?? 'unknown',
        focus,
      });
      const selectedEls = selection ?? [patternEl];
      const paths = selectedEls.map((el) => el.getAttribute('data-pattern-path') ?? 'root');
      const elements = selectedEls.flatMap((el) => { const f = focusOfElement(el); return f ? [f] : []; });
      setSelectedPaths(paths);
      setSelectedFocuses(elements);
      setExtraRects(selectedEls.filter((el) => el !== patternEl).flatMap((el) => {
        const r = rectRelativeTo(el, container, zoom);
        return r ? [r] : [];
      }));

      select({
        patternType: patternEl.getAttribute('data-pattern') ?? 'unknown',
        // `data-pattern-path` is the SExpr tree path (`children.0.…`) emitted by
        // UISlotRenderer; `data-id` is the runtime content id. `OrbInspector`
        // resolves pattern config by walking the render-ui SExpr tree, so the
        // path is the correct key — reading `data-id` silently broke prop
        // resolution and rendered every value as '—'.
        patternId: patternEl.getAttribute('data-pattern-path') ?? undefined,
        sourceTrait: patternEl.getAttribute('data-source-trait') ?? undefined,
        nodeData: data,
        rect: rect ?? undefined,
        offsetInParent: offsetInParentOf(patternEl, rect, container, zoom),
        selection: paths,
        elements,
        ...(focus ? { focus } : {}),
      });

      // Feed the studio chatbox's contextual-edit flow with the element's
      // address. The orbital is read from the DOM (`data-orb-orbital`, stamped
      // by UISlotRenderer from the schema context) rather than the node's own
      // name, so a click correctly attributes to whichever of N orbitals it hit.
      if (focus) {
        // Spread into a fresh literal (not the bare function return) —
        // `EditFocus` has no index signature, so TS's excess-property
        // leniency for object literals is what makes this assignable to
        // `EventPayload` without a cast; a typed non-literal value isn't.
        eventBus.emit('UI:ELEMENT_SELECTED', {
          focus: { ...focus },
        });
      }
    } else {
      setSelectedRect(null);
      setSelectedLayout(null);
      setSelectedScale(undefined);
      setSelectedAddress(null);
      setSelectedPaths([]);
      setSelectedFocuses([]);
      setExtraRects([]);
      select(null);
      eventBus.emit('UI:ELEMENT_SELECTED', { focus: null });
    }
  }, [focusOfElement, select, eventBus, reactFlow]);

  // Shift-click (with the multi-select tool) adds an element to the selection,
  // or takes a selected one out; the last one picked is the primary.
  const pickElement = useCallback((el: HTMLElement | null, additive: boolean) => {
    const picked = el ? focusOfElement(el) : null;
    if (!el || !picked || !additive || !hasCanvasTool(tools, 'multiSelect') || selectedFocuses.length === 0) {
      selectPatternElement(el);
      return;
    }
    const container = contentRef.current;
    const current = selectedFocuses.flatMap((f) => { const e = f.path ? elementIn(container, f.path, f.trait) : null; return e ? [e] : []; });
    if (selectedFocuses.some((f) => sameElement(f, picked))) {
      const rest = current.filter((e) => { const f = focusOfElement(e); return !f || !sameElement(f, picked); });
      selectPatternElement(rest[rest.length - 1] ?? null, rest.length > 0 ? rest : undefined);
      return;
    }
    selectPatternElement(el, [...current, el]);
  }, [tools, selectedFocuses, selectPatternElement, focusOfElement]);

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent React Flow from interpreting as node click
    const target = e.target as HTMLElement;
    pickElement(target.closest('[data-pattern]') as HTMLElement | null, e.shiftKey);
  }, [pickElement]);

  // Paths navigate within the trait that drew the selected element.
  const selectedTrait = selectedAddress?.focus?.trait;
  const patternElementAt = useCallback(
    (path: string): HTMLElement | null => elementIn(contentRef.current, path, selectedTrait),
    [selectedTrait],
  );

  // Paused: take the click in the capture phase so it selects and never
  // reaches the rendered control (whose handler would dispatch an event).
  const handlePausedClickCapture = useCallback((e: React.MouseEvent) => {
    // The selection overlay's own controls, and text being edited in place, handle their clicks.
    if (e.target instanceof Element && e.target.closest('[data-design-overlay]')) return;
    if (isEditableTarget(e.target)) return;
    // A marquee drag ends in a click on the card; it already selected.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      return;
    }
    handleContentClick(e);
    e.preventDefault();
    // Keys go to the focused element; take focus so the ones pressed next
    // (Enter, Esc, arrows, ⌘D, ⇧A) reach handlePausedKeyDown.
    contentRef.current?.focus({ preventScroll: true });
  }, [handleContentClick]);
  const swallowWhilePaused = useCallback((e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  // Paused keys edit the selection like Figma and never reach the preview's
  // controls: Enter selects the first child, Esc / Shift+Enter the parent,
  // the arrow keys move the selection among its siblings, ⌘D duplicates it
  // and ⇧A wraps it in an auto-layout stack. Delete (and Esc
  // with nothing selected) belong to FlowCanvas's own document-level handler,
  // so those keep propagating.
  const handlePausedKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Keys typed into the selection overlay's fields, or into text being edited in place, are theirs.
    if (e.target instanceof Element && e.target.closest('[data-design-overlay]')) return;
    if (isEditableTarget(e.target)) return;
    const path = selectedAddress?.patternId;
    const position = path ? childPosition(path) : null;
    const handled = (): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      return;
    }
    // Clipboard shortcuts must reach the browser, or it never fires copy/cut/paste.
    if ((e.metaKey || e.ctrlKey) && ['c', 'x', 'v'].includes(e.key.toLowerCase())) return;
    // ⇧2 zooms to the selection, ⇧1 fits everything (Figma).
    if (e.shiftKey && (e.code === 'Digit1' || e.code === 'Digit2') && hasCanvasTool(tools, 'zoomToSelection')) {
      handled();
      if (e.code === 'Digit1') {
        void reactFlow.fitView({ padding: 0.1, duration: cameraMs });
        return;
      }
      const container = contentRef.current;
      const targets = selectedFocuses.length > 0 ? selectedFocuses : selectedAddress?.focus ? [selectedAddress.focus] : [];
      const paths = targets.flatMap((f) => (f.path ? [f.path] : []));
      const boxes = targets.flatMap((f) => {
        const el = f.path ? elementIn(container, f.path, f.trait) : null;
        const box = el ? absUnion(el) : null;
        return box ? [box] : [];
      });
      if (boxes.length === 0) return;
      const topLeft = reactFlow.screenToFlowPosition({ x: Math.min(...boxes.map((b) => b.left)), y: Math.min(...boxes.map((b) => b.top)) });
      const bottomRight = reactFlow.screenToFlowPosition({ x: Math.max(...boxes.map((b) => b.right)), y: Math.max(...boxes.map((b) => b.bottom)) });
      orbPreviewLog.info('zoom-to-selection', { paths, boxes, topLeft, bottomRight });
      void reactFlow.fitBounds(
        { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y },
        { padding: 0.2, duration: cameraMs },
      );
      return;
    }
    if (e.key === 'Escape' || (e.key === 'Enter' && e.shiftKey)) {
      if (!path) return;
      handled();
      selectPatternElement(position ? patternElementAt(position.parentPath) : null);
      return;
    }
    if (e.key === 'Enter') {
      handled();
      const child = path ? patternElementAt(`${path}.children.0`) : null;
      if (child) selectPatternElement(child);
      return;
    }
    // The selected elements' own addresses. Any drawn by an embedded behavior
    // makes the edit a structure edit at those addresses — a path on the card
    // can't name an embedded behavior's place in its container.
    const focuses = selectedFocuses.length > 0 ? selectedFocuses : selectedAddress?.focus ? [selectedAddress.focus] : [];
    const addresses = focuses.map(elementAddressOf);
    const elements = focuses.length > 0 && addresses.every((a): a is NonNullable<typeof a> => a !== null) ? addresses : null;
    const embedded = elements !== null && elements.some((a) => a.trait !== data.traitName);
    const duplicate = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd';
    const wrap = e.shiftKey && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'a';
    if (duplicate || wrap) {
      handled();
      if (embedded && elements) {
        eventBus.emit('UI:STRUCTURE_EDIT', { op: duplicate ? 'duplicate' : 'wrap', elements });
        return;
      }
      if (!path || !position || !selectedAddress || !data.traitName || !data.transitionEvent) return;
      const loc = { orbitalName: data.orbitalName, traitName: data.traitName, transitionEvent: data.transitionEvent };
      const paths = selectedPaths.length > 0 ? selectedPaths : [path];
      const withElements: EventPayload = elements ? { elements } : {};
      if (duplicate) {
        eventBus.emit('UI:PATTERN_DUPLICATE', { paths, loc, ...withElements });
        if (paths.length > 1) {
          selectPatternElement(null);
          return;
        }
        const copy = `${position.parentPath}.children.${position.index + 1}`;
        const copyFocus = selectedAddress.focus && { ...selectedAddress.focus, path: copy };
        setSelectedAddress({ patternId: copy, patternType: selectedAddress.patternType, focus: copyFocus });
        setSelectedPaths([copy]);
        setSelectedFocuses(copyFocus ? [copyFocus] : []);
      } else {
        eventBus.emit('UI:PATTERN_WRAP', { paths, loc, ...withElements });
        // The wrapper takes the first wrapped element's place.
        const first = [...paths].sort((a, b) => (childPosition(a)?.index ?? 0) - (childPosition(b)?.index ?? 0))[0];
        const wrapperFocus = selectedAddress.focus && { ...selectedAddress.focus, path: first, patternType: 'stack' };
        setSelectedAddress({ patternId: first, patternType: 'stack', focus: wrapperFocus });
        setSelectedPaths([first]);
        setSelectedFocuses(wrapperFocus ? [wrapperFocus] : []);
        setExtraRects([]);
      }
      return;
    }
    const step = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
    // Every other key is swallowed so it can't activate the paused preview.
    handled();
    if (step === 0) return;
    if (embedded && elements) {
      // Its place in the container is the host's to find; the bounds too.
      if (elements.length === 1) eventBus.emit('UI:STRUCTURE_EDIT', { op: 'move', elements, by: step });
      return;
    }
    if (!path || !position || !selectedAddress || !data.traitName || !data.transitionEvent) return;
    const target = position.index + step;
    if (target < 0 || !patternElementAt(`${position.parentPath}.children.${target}`)) return;
    eventBus.emit('UI:PATTERN_MOVE', {
      fromPath: path,
      loc: { orbitalName: data.orbitalName, traitName: data.traitName, transitionEvent: data.transitionEvent },
      toParentPath: position.parentPath,
      // PATTERN_MOVE inserts before `toIndex` in the pre-move list.
      toIndex: step > 0 ? target + 1 : target,
      ...(elements ? { elements } : {}),
    });
    const moved = `${position.parentPath}.children.${target}`;
    const movedFocus = selectedAddress.focus && { ...selectedAddress.focus, path: moved };
    setSelectedAddress({ patternId: moved, patternType: selectedAddress.patternType, focus: movedFocus });
    setSelectedPaths([moved]);
    setSelectedFocuses(movedFocus ? [movedFocus] : []);
    setExtraRects([]);
  }, [selectedAddress, selectedPaths, selectedFocuses, eventBus, patternElementAt, selectPatternElement, data.orbitalName, data.traitName, data.transitionEvent, tools, reactFlow]);

  // ⌘C / ⌘X / ⌘V on a paused card: the browser's own clipboard events (no
  // permission prompt, works across cards and tabs). Nodes are copied as
  // stored in the schema; paste goes after the selection, or into a selected
  // container, or at the end of the card's root.
  const clipboardPaths = useCallback((): string[] => {
    const paths = selectedPaths.length > 0 ? selectedPaths : selectedAddress ? [selectedAddress.patternId] : [];
    return paths.filter((p) => p !== 'root');
  }, [selectedPaths, selectedAddress]);

  const copySelection = useCallback((e: React.ClipboardEvent): string[] => {
    const fullSchema = data._fullSchema as OrbitalSchema | undefined;
    const paths = clipboardPaths();
    if (!fullSchema || !data.traitName || !data.transitionEvent || paths.length === 0) return [];
    const nodes = paths.flatMap((path) => {
      const node = patternNodeAt(fullSchema, data.orbitalName, data.traitName ?? '', data.transitionEvent ?? '', path);
      return node ? [node] : [];
    });
    if (nodes.length === 0) return [];
    e.preventDefault();
    e.clipboardData.setData(PATTERN_CLIPBOARD_TYPE, JSON.stringify(nodes));
    e.clipboardData.setData('text/plain', JSON.stringify({ 'almadar/patterns': nodes }));
    return paths;
  }, [data._fullSchema, data.orbitalName, data.traitName, data.transitionEvent, clipboardPaths]);

  // Double-click text to edit it in place (L2 screens; at L1 double-click opens the orbital).
  const handleInlineText = useInlineTextEdit({
    schema: data._fullSchema as OrbitalSchema | undefined,
    enabled: !playing && isExpanded && hasCanvasTool(tools, 'inlineText'),
    node: data,
  });

  const handleCopy = useCallback((e: React.ClipboardEvent) => {
    if (!hasCanvasTool(tools, 'clipboard') || isEditableTarget(e.target)) return;
    copySelection(e);
  }, [tools, copySelection]);

  const handleCut = useCallback((e: React.ClipboardEvent) => {
    if (!hasCanvasTool(tools, 'clipboard') || isEditableTarget(e.target)) return;
    const paths = copySelection(e);
    if (paths.length === 0) return;
    const elements = selectedFocuses.flatMap((f) => { const a = f.path && paths.includes(f.path) ? elementAddressOf(f) : null; return a ? [a] : []; });
    eventBus.emit('UI:DELETE_PATTERN', { patternIds: paths, ...(elements.length === paths.length ? { elements } : {}) });
    selectPatternElement(null);
  }, [tools, copySelection, selectedFocuses, eventBus, selectPatternElement]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!hasCanvasTool(tools, 'clipboard') || isEditableTarget(e.target)) return;
    if (!data.traitName || !data.transitionEvent) return;
    const patterns = parseClipboardPatterns(e.clipboardData.getData(PATTERN_CLIPBOARD_TYPE))
      ?? parseClipboardPatterns(e.clipboardData.getData('text/plain'));
    if (!patterns) return;
    e.preventDefault();
    const container = contentRef.current;
    const childCount = (path: string) => resolveDirectChildren(
      path,
      Array.from(container?.querySelectorAll('[data-pattern-path]') ?? []).map((el) => ({ path: el.getAttribute('data-pattern-path') ?? '', ref: el })),
    ).length;
    const primary = selectedAddress?.patternId;
    const primaryEl = primary ? patternElementAt(primary) : null;
    const position = primary ? childPosition(primary) : null;
    const target = primary && primaryEl?.getAttribute('data-accepts-children') === 'true'
      ? { parentPath: primary, index: childCount(primary) }
      : position
        ? { parentPath: position.parentPath, index: position.index + 1 }
        : { parentPath: 'root', index: childCount('root') };
    eventBus.emit('UI:PATTERN_PASTE', {
      loc: { orbitalName: data.orbitalName, traitName: data.traitName, transitionEvent: data.transitionEvent },
      ...target,
      patternsJson: JSON.stringify(patterns),
    });
  }, [tools, data.orbitalName, data.traitName, data.transitionEvent, selectedAddress, patternElementAt, eventBus]);

  // Hover overlay — track the nearest [data-pattern] under the cursor.
  // ⌥-hover (Figma): distances from the selection to the hovered element, or
  // to its parent when hovering the selection itself.
  const measureFromSelection = useCallback((hovered: HTMLElement | null) => {
    const container = contentRef.current;
    const selectedEl = selectedAddress ? patternElementAt(selectedAddress.patternId) : null;
    if (!hovered || !container || !selectedEl || !selectedRect || playing || !hasCanvasTool(tools, 'measure')) {
      setMeasures((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const zoom = reactFlow.getViewport().zoom;
    const other = hovered === selectedEl ? parentBoxOf(selectedEl, container, zoom)?.box ?? null : rectRelativeTo(hovered, container, zoom);
    setMeasures(other ? distanceLines(selectedRect, other) : []);
  }, [selectedAddress, selectedRect, playing, tools, reactFlow, patternElementAt]);

  // Letting go of ⌥ clears the measurements.
  useEffect(() => {
    if (measures.length === 0) return;
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') setMeasures([]); };
    window.addEventListener('keyup', up);
    return () => window.removeEventListener('keyup', up);
  }, [measures.length]);

  const handleContentMouseMove = useCallback((e: React.MouseEvent) => {
    const container = contentRef.current;
    if (!container) return;
    const el = (e.target as HTMLElement).closest('[data-pattern]') as HTMLElement | null;
    measureFromSelection(e.altKey ? el : null);
    if (el === lastHoverElRef.current) return;
    lastHoverElRef.current = el;
    setHoverRect(el ? rectRelativeTo(el, container, reactFlow.getViewport().zoom) : null);
  }, [reactFlow, measureFromSelection]);

  const handleContentMouseLeave = useCallback(() => {
    lastHoverElRef.current = null;
    setHoverRect(null);
    setMeasures([]);
  }, []);

  // Drop stale overlays whenever the rendered schema changes (post-edit
  // re-render moves elements; a stale rect would float over the wrong spot).
  // The selection itself survives an edit: re-measure the same element once
  // the new render has painted, like a design tool keeping its selection.
  const selectedAddressRef = useRef(selectedAddress);
  selectedAddressRef.current = selectedAddress;
  useEffect(() => {
    setSelectedRect(null);
    setHoverRect(null);
    lastHoverElRef.current = null;
    const address = selectedAddressRef.current;
    if (!address) return;
    const frame = requestAnimationFrame(() => {
      const container = contentRef.current;
      const el = elementIn(container, address.patternId, address.focus?.trait);
      if (container && el) {
        const zoom = reactFlow.getViewport().zoom;
        setSelectedRect(rectRelativeTo(el, container, zoom));
        setSelectedLayout(measureLayout(el, container, zoom));
        setSelectedScale(() => spacingScaleOf(layoutBoxOf(el)));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [orbitalSchema, reactFlow]);

  // The selected element's own classes (null when `className` is a binding):
  // what the design overlay edits. Canvas edits go through the same
  // `UI:PROP_CHANGE` (scope local) the inspector emits.
  const selectedClasses = useMemo<string[] | null>(() => {
    const fullSchema = data._fullSchema as OrbitalSchema | undefined;
    const focus = selectedAddress?.focus;
    if (!selectedAddress || !fullSchema || !focus?.trait || !focus.transition) return null;
    const config = resolvePatternConfig(fullSchema, {
      orbitalName: focus.orbital,
      traitName: focus.trait,
      transitionEvent: focus.transition,
      patternId: selectedAddress.patternId,
      patternType: selectedAddress.patternType,
    });
    const current = config?.className;
    if (current === undefined || current === null) return [];
    return typeof current === 'string' ? current.split(/\s+/).filter(Boolean) : null;
  }, [data, selectedAddress]);

  // What the host lets the user change on the selected element (its classes
  // drive the design handles), and the behavior it belongs to when embedded.
  const editAccess = useContext(ElementEditAccessContext);
  const selectedFocus = selectedAddress?.focus ?? null;
  const classesEditable = propAccessAt(editAccess, selectedFocus, 'className').editable;
  const selectedPartOf = editAccess && selectedFocus ? editAccess(selectedFocus).partOf : undefined;

  const handleClassesChange = useCallback((next: string[]) => {
    const focus = selectedAddress?.focus;
    if (!selectedAddress || !focus?.trait || !focus.transition) return;
    eventBus.emit('UI:PROP_CHANGE', {
      scope: 'local',
      propName: 'className',
      value: next.join(' '),
      selection: {
        patternPath: selectedAddress.patternId,
        orbitalName: focus.orbital,
        traitName: focus.trait,
        transitionEvent: focus.transition,
        ...(focus.slot ? { slot: focus.slot } : {}),
      },
    });
  }, [selectedAddress, eventBus]);

  const [dragActive, setDragActive] = useState(false);

  // Listen for drag start/end from PatternPalette to toggle container highlighting
  useEffect(() => {
    const unsub1 = eventBus.on('UI:DRAG_START', (e) => {
      const kind = e.payload?.kind;
      if (kind === 'pattern') setDragActive(true);
    });
    const unsub2 = eventBus.on('UI:DRAG_END', () => setDragActive(false));
    return () => { unsub1(); unsub2(); };
  }, [eventBus]);

  // Same, but scoped to an L2 reorder grab (kept separate from `dragActive`
  // above so the L1 "drop to add and open" hint — which only applies to
  // `'pattern'` palette drops, L1 doesn't accept `'pattern-instance'` —
  // doesn't light up during a reorder). Drives only the L2 content area's
  // `drag-active` styling.
  const [reorderDragActive, setReorderDragActive] = useState(false);
  useEffect(() => {
    const unsub1 = eventBus.on('UI:DRAG_START', (e) => {
      if (e.payload?.kind === 'pattern-instance') setReorderDragActive(true);
    });
    const unsub2 = eventBus.on('UI:DRAG_END', () => setReorderDragActive(false));
    return () => { unsub1(); unsub2(); };
  }, [eventBus]);

  // L2 cursor-to-path resolver. Walks from the cursor's DOM element up to the
  // nearest `[data-accepts-children="true"]` container, then computes the
  // insertion index from the cursor's relative position among the container's
  // direct `[data-pattern-path]` children. Runs at drop time via @dnd-kit's
  // resolvePath callback — same logic the legacy `onDrop` ran inline.
  const resolveInsertion = useCallback(
    (cursor: { x: number; y: number }): InsertionTarget | null => {
      const hit = renderedElementAt(contentRef.current, cursor);
      if (!hit) return null;
      let el: HTMLElement | null = hit;
      while (el && el.dataset.acceptsChildren !== 'true') {
        if (el === contentRef.current) break;
        el = el.parentElement;
      }
      if (!el) return null;
      // Dead space inside the screen but outside any accepts-children
      // container (below the last child, padding) walks up to contentRef,
      // which carries no path — resolve those drops against the root
      // container's children with the same index math (a below-everything
      // drop then lands at the END, not hardcoded index 0).
      const containerPath = el.dataset?.patternPath ?? 'root';
      // Axis must come from the container we resolve against: in the
      // dead-space fallback `el` is contentRef (a plain block, whose computed
      // flexDirection defaults to 'row'), so retarget to the root wrapper.
      if (!el.dataset?.patternPath) {
        const rootEl = el.querySelector('[data-pattern-path="root"]');
        if (rootEl instanceof HTMLElement) el = rootEl;
      }
      // Direct children in the pattern tree — its own nodes and the frames of
      // behaviors embedded in its children (whose paths restart at `root`).
      const directChildren = directPatternChildren(el);
      // Each child is a UISlotRenderer `slot-content contents` wrapper — its
      // own getBoundingClientRect() is 0x0 (display:contents) — union its
      // rendered descendants' boxes instead (see absUnion above), falling
      // back to the raw rect when the element does carry its own box.
      const childRects: DOMRectLike[] = directChildren.map((child) => {
        const u = absUnion(child);
        if (u) return { ...u, width: u.right - u.left, height: u.bottom - u.top };
        const raw = child.getBoundingClientRect();
        return { top: raw.top, left: raw.left, right: raw.right, bottom: raw.bottom, width: raw.width, height: raw.height };
      });
      const axis = resolveLayoutAxis(el);
      const insertIndex = computeInsertionIndex(childRects, cursor, axis);
      orbPreviewLog.debug('resolveL2Path', {
        containerPath,
        childCount: childRects.length,
        axis,
        cursorY: cursor.y,
        mids: childRects.map((r) => (axis === 'vertical' ? r.top + r.height / 2 : r.left + r.width / 2)),
        insertIndex,
      });
      const own = absUnion(el);
      const containerBox: DOMRectLike = own
        ? { ...own, width: own.right - own.left, height: own.bottom - own.top }
        : (() => {
            const raw = el.getBoundingClientRect();
            return { top: raw.top, left: raw.left, right: raw.right, bottom: raw.bottom, width: raw.width, height: raw.height };
          })();
      const focus = focusOfElement(el);
      const container = focus ? elementAddressOf(focus) : null;
      return { parentPath: containerPath, index: insertIndex, container, containerBox, childRects, axis };
    },
    [focusOfElement],
  );
  const resolveL2Path = useCallback(
    (cursor: { x: number; y: number }): { parentPath: string; index: number; container?: DropContainer } | null => {
      const hit = resolveInsertion(cursor);
      return hit ? { parentPath: hit.parentPath, index: hit.index, ...(hit.container ? { container: hit.container } : {}) } : null;
    },
    [resolveInsertion],
  );

  // Figma's blue insertion indicator: while a pattern is dragged over this
  // card, show where it would land among its new siblings.
  const [insertionLine, setInsertionLine] = useState<RectLike | null>(null);
  const trackInsertion = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!(dragActive || reorderDragActive) || !isExpanded) return;
    const content = contentRef.current;
    const hit = resolveInsertion({ x: e.clientX, y: e.clientY });
    if (!content || !hit) {
      setInsertionLine(null);
      return;
    }
    const base = content.getBoundingClientRect();
    const z = reactFlow.getViewport().zoom || 1;
    const toContent = (r: DOMRectLike): RectLike => ({
      top: (r.top - base.top) / z,
      left: (r.left - base.left) / z,
      width: r.width / z,
      height: r.height / z,
    });
    setInsertionLine(insertionLineRect(toContent(hit.containerBox), hit.childRects.map(toContent), hit.index, hit.axis));
  }, [dragActive, reorderDragActive, isExpanded, resolveInsertion, reactFlow]);
  useEffect(() => {
    if (!dragActive && !reorderDragActive) setInsertionLine(null);
  }, [dragActive, reorderDragActive]);

  // L2 inner zone — the render-ui slot inside the expanded orbital. Each
  // OrbPreviewNode owns one. @dnd-kit's useCanvasDroppable manages the
  // pointer-driven over/drop lifecycle; `resolvePath` extracts the precise
  // (parentPath, index) at drop time.
  const l2Target = useMemo<CanvasDropTarget>(
    () => ({
      level: 'l2',
      containerNode: {
        orbitalName: data.orbitalName,
        traitName: data.traitName,
        transitionEvent: data.transitionEvent,
      },
      resolvePath: resolveL2Path,
    }),
    [data.orbitalName, data.traitName, data.transitionEvent, resolveL2Path],
  );
  const { setNodeRef: l2SetNodeRef, isOver: l2IsOver } = useCanvasDroppable({
    // Keyed by the card, not its trait/transition: several screen cards can share those.
    id: `orb-l2-${props.id}`,
    target: l2Target,
    accepts: ['pattern', 'pattern-instance', 'behavior'],
    disabled: !isExpanded,
  });

  // L2 reorder drag SOURCE — dragging an already-placed pattern by its own
  // rendered content (not a palette tile). One `useCanvasDraggable` per node
  // (not per pattern element, since patterns render several layers deep
  // inside UISlotRenderer/OrbPreview, outside this component's JSX)
  // with listeners merged onto the same content container that already owns
  // click-to-select. `reorderDataRef` is a STABLE object mutated in place at
  // pointerdown — dnd-kit reads `active.data.current` (a ref to whatever
  // `data` object was passed) at drag-end time, so if `data` were a fresh
  // object built from React state instead, a mousemove crossing into a
  // different pattern mid-drag (after activation) would silently overwrite
  // it before drag-end reads it. Mutating the same reference sidesteps that
  // render-timing race entirely.
  const reorderDataRef = useRef<PatternInstanceDragData>({ fromPath: '', loc: {} });
  const {
    setNodeRef: reorderSetNodeRef,
    listeners: reorderListeners,
  } = useCanvasDraggable({
    id: `orb-l2-reorder-${props.id}`,
    payload: { kind: 'pattern-instance', data: reorderDataRef.current },
    disabled: !isExpanded,
  });

  // Resolves the grabbed pattern from the pointerdown target (same
  // `closest('[data-pattern]')` walk as click-to-select), freezes it into
  // `reorderDataRef`, then hands off to dnd-kit's own activator. No-ops
  // (never calls the activator) when the pointerdown didn't land on a
  // pattern or reorder is disabled (`reorderListeners` is `undefined` then).
  // Drag on the card's own frame (its root, not an element in it) draws a
  // marquee; the root's children it touches become the selection (Figma).
  const startMarquee = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const container = contentRef.current;
    if (!container) return;
    const zoom = reactFlow.getViewport().zoom || 1;
    const toContent = (clientX: number, clientY: number) => {
      const base = container.getBoundingClientRect();
      return { x: (clientX - base.left) / zoom, y: (clientY - base.top) / zoom };
    };
    const from = toContent(e.clientX, e.clientY);
    let box: OverlayRect | null = null;
    const move = (ev: PointerEvent) => {
      const to = toContent(ev.clientX, ev.clientY);
      if (!box && Math.hypot(to.x - from.x, to.y - from.y) < 3) return;
      box = marqueeRect(from, to);
      setMarquee(box);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarquee(null);
      if (!box) return;
      const children = resolveDirectChildren(
        'root',
        Array.from(container.querySelectorAll('[data-pattern-path]')).map((el) => ({ path: el.getAttribute('data-pattern-path') ?? '', ref: el })),
      );
      const rects = children.map((el) => rectRelativeTo(el, container, zoom));
      const hits = marqueeHits(box, rects.map((r) => r ?? { top: 0, left: 0, width: 0, height: 0 }))
        .filter((i) => rects[i] !== null)
        .map((i) => children[i]);
      suppressClickRef.current = true;
      const selected = hits.filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('data-pattern-path'));
      const primary = selected[selected.length - 1];
      selectPatternElement(primary ?? null, selected.length > 0 ? selected : undefined);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [reactFlow, selectPatternElement]);

  // Dragging the selected absolute element moves it (Figma): it follows the
  // pointer, snapping to its siblings' and parent's edges and centres (smart
  // guides), and on release its offsets are rewritten for its constraints.
  const startAbsoluteMove = useCallback((e: React.PointerEvent<HTMLDivElement>, el: HTMLElement, classes: readonly string[]) => {
    const container = contentRef.current;
    const zoom = reactFlow.getViewport().zoom || 1;
    const start = container ? rectRelativeTo(el, container, zoom) : null;
    const parent = container ? parentBoxOf(el, container, zoom) : null;
    if (!container || !start || !parent) return;
    const parentPath = parent.el.getAttribute('data-pattern-path') ?? 'root';
    const siblings = resolveDirectChildren(
      parentPath,
      Array.from(parent.el.querySelectorAll('[data-pattern-path]')).map((c) => ({ path: c.getAttribute('data-pattern-path') ?? '', ref: c })),
    ).filter((c) => c !== el).map((c) => rectRelativeTo(c, container, zoom)).filter((r): r is RectLike => r !== null);
    const targets = [...siblings, parent.box];
    const moved = layoutBoxOf(el);
    const painted = moved instanceof HTMLElement ? moved : null;
    const before = painted?.style.translate ?? '';
    let current: RectLike = start;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - e.clientX) / zoom;
      const dy = (ev.clientY - e.clientY) / zoom;
      if (!dragging && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      dragging = true;
      const raw = { ...start, left: start.left + dx, top: start.top + dy };
      const snap = snapMove(raw, targets, 4 / zoom);
      current = { ...raw, left: raw.left + snap.dx, top: raw.top + snap.dy };
      if (painted) painted.style.translate = `${current.left - start.left}px ${current.top - start.top}px`;
      setGuides(snap.guides);
      setSelectedRect(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setGuides([]);
      if (!dragging) return;
      if (painted) painted.style.translate = before;
      suppressClickRef.current = true;
      const position = positionOf(classes);
      const offset = offsetWithin(current, parent.box);
      handleClassesChange(withPosition(classes, {
        absolute: true,
        x: axisPositionFrom('x', position.x.constraint, offset),
        y: axisPositionFrom('y', position.y.constraint, offset),
      }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [reactFlow, handleClassesChange]);

  const handleContentPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const patternEl = (e.target as HTMLElement).closest('[data-pattern]') as HTMLElement | null;
    const fromPath = patternEl?.getAttribute('data-pattern-path');
    const selectedEl = selectedAddress ? patternElementAt(selectedAddress.patternId) : null;
    if (!playing && isExpanded && e.button === 0 && hasCanvasTool(tools, 'absolute') && selectedEl && selectedClasses?.includes('absolute')
      && e.target instanceof Node && selectedEl.contains(e.target) && !(e.target instanceof Element && e.target.closest('[data-design-overlay]'))) {
      startAbsoluteMove(e, selectedEl, selectedClasses);
      return;
    }
    if (!playing && isExpanded && hasCanvasTool(tools, 'multiSelect') && (fromPath === 'root' || !fromPath)
      && !(e.target instanceof Element && e.target.closest('[data-design-overlay]'))) {
      startMarquee(e);
      return;
    }
    if (!fromPath) return;
    reorderDataRef.current.fromPath = fromPath;
    reorderDataRef.current.loc = {
      orbitalName: data.orbitalName,
      traitName: data.traitName,
      transitionEvent: data.transitionEvent,
    };
    reorderListeners?.onPointerDown?.(e);
  }, [reorderListeners, data.orbitalName, data.traitName, data.transitionEvent, playing, isExpanded, tools, startMarquee, selectedAddress, selectedClasses, patternElementAt, startAbsoluteMove]);

  // Callback ref that fans the same DOM node to both useRef + dnd-kit.
  // contentRef stays read-only for the click-to-select walker; l2SetNodeRef
  // registers the node as a droppable, reorderSetNodeRef as the reorder
  // draggable (dnd-kit fully supports a node being both).
  const setContentRef = useCallback((el: HTMLDivElement | null) => {
    contentRef.current = el;
    l2SetNodeRef(el);
    reorderSetNodeRef(el);
  }, [l2SetNodeRef, reorderSetNodeRef]);

  // Status-driven outline color. Running > error > success > hover > default.
  const statusBorder = isRunning
    ? 'var(--color-primary)'
    : isError
      ? 'var(--color-danger)'
      : isSuccess
        ? 'var(--color-success)'
        : null;
  const borderWidth = isRunning || isError || isSuccess || data.focused ? '2px' : '1.5px';
  const borderColor = statusBorder ?? (hovered || data.focused ? 'var(--color-primary)' : colors.border);

  // L1 outer drop zone — fires when a palette-pattern is dropped on the
  // orbital's frame outside the inner render-ui preview. Emits the default
  // UI:PATTERN_DROP with a partial containerNode (orbital only) so the
  // page-level handler can resolve to the orbital's first render-ui
  // transition.
  const l1Target = useMemo<CanvasDropTarget>(
    () => ({ level: 'l1', containerNode: { orbitalName: data.orbitalName } }),
    [data.orbitalName],
  );
  const { setNodeRef: l1SetNodeRef, isOver: l1IsOver } = useCanvasDroppable({
    id: `orb-l1-${data.orbitalName}`,
    target: l1Target,
    accepts: ['pattern'],
    disabled: isExpanded,
  });

  return (
    <Box
      ref={isExpanded ? undefined : l1SetNodeRef}
      className={`@container/preview rounded-lg border shadow-sm bg-card transition-all duration-200 overflow-hidden relative${isRunning ? ' orb-preview-running' : ''}`}
      style={{
        borderColor: l1IsOver ? 'var(--color-primary)' : borderColor,
        borderWidth: l1IsOver ? '2px' : borderWidth,
        width: typeof data.cardWidth === 'number' ? data.cardWidth : preset.width,
        boxShadow: l1IsOver ? '0 0 0 3px var(--color-primary), 0 0 12px var(--color-primary)' : undefined,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Inject selection highlight CSS */}
      <style>{SELECTION_STYLES}</style>

      {/* L1 affordances — only render at overview level (no traitName).
          Preview badge is always visible so the user knows the embedded
          render is sample data. Click-to-open overlay surfaces on hover.
          Drop-to-place overlay surfaces when a palette pattern is being
          dragged anywhere on the canvas. */}
      {!isExpanded && (
        <>
          <Box
            className="absolute top-1.5 right-1.5 rounded px-1 py-[1px] text-xs font-mono uppercase tracking-wider pointer-events-none"
            style={{
              backgroundColor: 'var(--color-muted)',
              color: 'var(--color-muted-foreground)',
              zIndex: 3,
            }}
          >
            {t('orbPreview.previewBadge')}
          </Box>
          {hovered && !dragActive && !l1IsOver && (
            <Box
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{
                backgroundColor: avlTint('var(--color-foreground)', 4),
                zIndex: 2,
              }}
            >
              <Box
                className="rounded-md px-2 py-1 text-xs font-medium flex items-center gap-1"
                style={{
                  backgroundColor: 'var(--color-card)',
                  color: 'var(--color-foreground)',
                  boxShadow: 'var(--shadow-main)',
                }}
              >
                <span style={{ fontSize: 12 }}>{'➞'}</span>
                {t('orbPreview.doubleClickToOpen')}
              </Box>
            </Box>
          )}
          {(dragActive || l1IsOver) && (
            <Box
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{
                backgroundColor: l1IsOver ? avlTint('var(--color-primary)', 15) : avlTint('var(--color-primary)', 6),
                zIndex: 2,
              }}
            >
              <Box
                className="rounded-md px-2 py-1 text-xs font-semibold"
                style={{
                  backgroundColor: 'var(--color-primary)',
                  color: 'var(--color-primary-foreground)',
                  boxShadow: 'var(--shadow-lg)',
                }}
              >
                {t('orbPreview.dropToAddAndOpen')}
              </Box>
            </Box>
          )}
        </>
      )}
      {/* Running-state pulse — subtle inner glow + corner spinner. Inert to
          pointer events so the existing canvas interactions stay intact. */}
      {isRunning && (
        <>
          <style>{`
            @keyframes orb-preview-running-pulse {
              0%, 100% { box-shadow: 0 0 0 0 var(--color-primary); opacity: 0.6; }
              50%      { box-shadow: 0 0 0 4px var(--color-primary); opacity: 0.15; }
            }
            .orb-preview-running {
              animation: orb-preview-running-pulse 1.8s ease-in-out infinite;
            }
            @keyframes orb-preview-spinner {
              from { transform: rotate(0deg); }
              to   { transform: rotate(360deg); }
            }
            .orb-preview-spinner {
              animation: orb-preview-spinner 0.9s linear infinite;
            }
          `}</style>
          <Box
            className="orb-preview-spinner absolute top-2 right-2 rounded-full pointer-events-none"
            style={{
              width: 14,
              height: 14,
              border: '2px solid var(--color-primary)',
              borderTopColor: 'transparent',
              zIndex: 2,
            }}
            title={t('orbPreview.dispatching')}
          />
        </>
      )}
      {isError && (
        <Box
          data-testid="orb-preview-error-badge"
          className="absolute top-2 right-2 flex items-center justify-center rounded-full pointer-events-none"
          style={{ width: 18, height: 18, background: 'var(--color-error)', color: 'var(--color-background)', zIndex: 2 }}
          title={t('orbPreview.hasProblems')}
        >
          <Icon name="alert-triangle" size="xs" />
        </Box>
      )}

      {/* Layer color band */}
      {layerColor && (
        <Box
          style={{ height: 3, backgroundColor: layerColor }}
          title={data.layer && LAYER_LABEL_KEYS[data.layer] ? t(LAYER_LABEL_KEYS[data.layer]) : data.layer}
        />
      )}

      {/* Header - this is the drag handle */}
      <Box className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 drag-handle cursor-grab">
        <Box
          className="rounded-full shrink-0"
          style={{ width: 8, height: 8, backgroundColor: colors.dot }}
        />
        <Box className="flex flex-col min-w-0 flex-1">
          <Typography variant="small" className="font-semibold truncate leading-tight">
            {data.orbitalName}
          </Typography>
          {sublabel && (
            <Typography variant="small" className="text-muted-foreground truncate text-xs leading-tight">
              {sublabel}
            </Typography>
          )}
        </Box>
        {stateOptions && statePicker && (
          <Box className="nodrag shrink-0 max-w-[55%]" onClick={(e) => e.stopPropagation()}>
            <Select
              options={stateOptions.options}
              groups={stateOptions.groups}
              value={statePicker.chosen(data.orbitalName)}
              onValueChange={(value) => { if (typeof value === 'string') statePicker.choose(data.orbitalName, value); }}
              aria-label={t('canvas.stateOf', { orbital: data.orbitalName })}
              data-testid={`canvas-state-${data.orbitalName}`}
              className="h-7 py-0 text-xs"
            />
          </Box>
        )}
        {shownStep && (
          <Box className="nodrag flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {verdict && (
              <Badge
                variant={VERDICT_VARIANT[verdict.status]}
                size="sm"
                data-testid={`card-verdict-${data.orbitalName}`}
                data-status={verdict.status}
                title={verdict.detail}
              >
                {t(`canvas.verdict.${verdict.status}`)}
              </Badge>
            )}
            <IconButton
              icon="check-circle"
              label={t('canvas.verifyTransition')}
              tooltipPosition="top"
              className="w-6 h-6"
              data-testid={`card-verify-transition-${data.orbitalName}`}
              onClick={() => eventBus.emit('UI:CARD_VERIFY_STEP', { orbital: data.orbitalName, trait: shownStep.trait, from: shownStep.from, event: shownStep.event, payload: {} })}
            />
            {verifyPlaying ? (
              <>
                <IconButton icon="pause" label={t('canvas.verifyPause')} tooltipPosition="top" className="w-6 h-6" data-testid={`card-verify-pause-${data.orbitalName}`} onClick={() => eventBus.emit('UI:CARD_VERIFY_PAUSE', { orbital: data.orbitalName, trait: shownStep.trait })} />
                <IconButton icon="square" label={t('canvas.verifyStop')} tooltipPosition="top" className="w-6 h-6" data-testid={`card-verify-stop-${data.orbitalName}`} onClick={() => eventBus.emit('UI:CARD_VERIFY_STOP', { orbital: data.orbitalName, trait: shownStep.trait })} />
              </>
            ) : (
              <IconButton
                icon="list-checks"
                label={t('canvas.verifyTrait')}
                tooltipPosition="top"
                className="w-6 h-6"
                data-testid={`card-verify-trait-${data.orbitalName}`}
                onClick={() => eventBus.emit('UI:CARD_VERIFY_TRAIT', { orbital: data.orbitalName, trait: shownStep.trait })}
              />
            )}
          </Box>
        )}
        <IconButton
          icon={playing ? 'pause' : 'play'}
          label={t(playing ? 'orbPreview.pause' : 'orbPreview.play')}
          tooltipPosition="top"
          className="nodrag shrink-0 w-6 h-6"
          aria-pressed={playing}
          data-testid="orb-preview-play-toggle"
          onClick={togglePlaying}
        />
        {eventSources.length > 0 && (
          <Box className="flex gap-0.5 shrink-0">
            {eventSources.slice(0, 3).map((src) => (
              <Box
                key={src.event}
                className="rounded-full px-1 py-0 text-xs font-medium leading-tight"
                style={{
                  backgroundColor: avlTint(CONNECTION_COLORS.emitListen.color, 8),
                  color: CONNECTION_COLORS.emitListen.color,
                  border: `1px solid ${avlTint(CONNECTION_COLORS.emitListen.color, 19)}`,
                }}
                title={`${src.label ?? src.patternType} \u2192 ${src.event}${src.payloadFields?.length ? ` ${formatPayloadTooltip(src.payloadFields)}` : ''}`}
              >
                {src.label ?? src.event}
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* OrbPreview - always interactive, click to select patterns. The
          ref is set by `setContentRef`, which fans the node to
          contentRef (read by handleContentClick), @dnd-kit's L2 droppable,
          AND the L2 reorder draggable. `nodrag` keeps React Flow's own
          node-drag out of this whole region and `nopan` keeps its pane pan
          out (a card that isn't draggable pans the pane otherwise), so the
          reorder / marquee / drop gestures always reach the preview. */}
      <Box
        ref={setContentRef}
        className={`orb-preview-live nodrag nopan relative outline-none focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring focus-visible:ring-inset${dragActive || reorderDragActive || l2IsOver ? ' drag-active' : ''}`}
        data-playing={playing}
        onClick={playing ? handleContentClick : undefined}
        onClickCapture={playing ? undefined : handlePausedClickCapture}
        onKeyDownCapture={playing ? undefined : handlePausedKeyDown}
        tabIndex={playing ? undefined : -1}
        onSubmitCapture={playing ? undefined : swallowWhilePaused}
        onDoubleClickCapture={playing ? undefined : handleInlineText}
        onCopyCapture={playing ? undefined : handleCopy}
        onCutCapture={playing ? undefined : handleCut}
        onPasteCapture={playing ? undefined : handlePaste}
        onMouseMove={handleContentMouseMove}
        onMouseLeave={handleContentMouseLeave}
        onPointerDown={handleContentPointerDown}
        onPointerMove={trackInsertion}
      >
        {/* Hover + selection overlays. Positioned over the element's painted
            bounds (the [data-pattern] wrapper is display:contents, so CSS
            outline on it paints nothing — this overlay is the highlight). */}
        {hoverRect && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              pointerEvents: 'none',
              top: hoverRect.top,
              left: hoverRect.left,
              width: hoverRect.width,
              height: hoverRect.height,
              outline: '2px dashed var(--color-primary)',
              outlineOffset: '1px',
              borderRadius: '2px',
              zIndex: 20,
            }}
          />
        )}
        {insertionLine && (
          <Box
            aria-hidden
            data-testid="orb-preview-insertion-line"
            className="rounded-full bg-primary"
            style={{
              position: 'absolute',
              pointerEvents: 'none',
              top: insertionLine.top,
              left: insertionLine.left,
              width: insertionLine.width,
              height: insertionLine.height,
              zIndex: 22,
            }}
          />
        )}
        {extraRects.map((r, i) => (
          <Box
            key={`extra-${i}`}
            data-testid="orb-preview-selection-extra"
            style={{ position: 'absolute', pointerEvents: 'none', top: r.top, left: r.left, width: r.width, height: r.height, outline: '2px solid var(--color-primary)', outlineOffset: '1px', borderRadius: '2px', zIndex: 21 }}
          />
        ))}
        {marquee && (
          <Box
            data-testid="orb-preview-marquee"
            className="border border-primary bg-primary/10"
            style={{ position: 'absolute', pointerEvents: 'none', top: marquee.top, left: marquee.left, width: marquee.width, height: marquee.height, zIndex: 23 }}
          />
        )}
        <DesignGuidesOverlay guides={guides} measures={measures} zoom={reactFlow.getViewport().zoom} />
        {selectedRect && (
          <DesignSelectionOverlay
            rect={selectedRect}
            childRects={selectedLayout?.childRects ?? []}
            axis={selectedLayout?.axis ?? null}
            alignment={selectedLayout?.alignment}
            pxOfStep={selectedScale}
            renderedSpacing={selectedLayout?.spacing}
            classes={!playing && isExpanded && hasCanvasTool(tools, 'designHandles') && classesEditable ? selectedClasses : null}
            layoutBar={hasCanvasTool(tools, 'autoLayout')}
            zoom={reactFlow.getViewport().zoom}
            onChange={handleClassesChange}
          />
        )}
        {selectedRect && selectedPartOf && (
          <Box
            data-testid="orb-preview-part-of"
            className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground shadow-sm"
            style={{ position: 'absolute', pointerEvents: 'none', top: Math.max(0, selectedRect.top - 22), left: selectedRect.left, zIndex: 24 }}
          >
            <Typography variant="caption">{t('orbPreview.partOf', { behavior: selectedPartOf })}</Typography>
          </Box>
        )}
        {orbitalSchema ? (
          // L1 and L2 both auto-grow with content. L2's `buildTransitionSchema`
          // rewrites portal slots (modal/drawer/overlay/center) to `main`, so
          // the rendered pattern lands inline in the main slot and contributes
          // to the card's height — same height model as L1 orbital cards.
          <Box style={{ minHeight: preset.minHeight }}>
            <OrbPreview
              schema={orbitalSchema}
              isolated
              height="auto"
              paused={!playing}
            />
          </Box>
        ) : (
          <Box className="flex items-center justify-center" style={{ minHeight: preset.minHeight }}>
            <Typography variant="small" className="text-muted-foreground">
              {t('orbPreview.noPreview')}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Frame width: the right edge resizes the card; the width is persisted with its position. */}
      <NodeResizeControl
        position="right"
        variant={ResizeControlVariant.Line}
        minWidth={CARD_MIN_WIDTH}
        maxWidth={CARD_MAX_WIDTH}
        shouldResize={(_event, params) => params.direction[0] !== 0}
        onResizeEnd={(_event, params) => {
          eventBus.emit('UI:CANVAS_CARD_RESIZED', { nodeId: props.id, width: Math.round(params.width) });
        }}
      />

      {/* Handles */}
      <Handle type="target" position={Position.Left} style={TARGET_HANDLE_STYLE} />
      {eventSources.length === 0 && (
        <Handle type="source" position={Position.Right} style={TARGET_HANDLE_STYLE} />
      )}
      {eventSources.map((src) => (
        <Handle
          key={`event-${src.event}`}
          id={`event-${src.event}`}
          type="source"
          position={Position.Right}
          style={eventHandleStyle(src)}
          title={`${src.label ?? src.patternType}: ${src.event}${src.payloadFields?.length ? ` ${formatPayloadTooltip(src.payloadFields)}` : ''}`}
        />
      ))}
    </Box>
  );
};

export const OrbPreviewNode = React.memo(OrbPreviewNodeInner);
OrbPreviewNode.displayName = 'OrbPreviewNode';

orbPreviewLog.debug('export-resolved', () => ({
  type: typeof OrbPreviewNode,
  displayName: OrbPreviewNode.displayName ?? null,
  innerDefined: typeof OrbPreviewNodeInner === 'function',
}));
