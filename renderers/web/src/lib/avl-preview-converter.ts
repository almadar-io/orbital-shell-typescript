/**
 * AVL Preview Converter
 *
 * Extracts render-ui pattern configs from OrbitalSchema transitions
 * and builds the FlowCanvas graph: one card per orbital (all of them, or
 * only the focused one), each showing the live orbital or a state picked
 * from its dropdown (`stateOptionsOf`).
 *
 * Key feature: detects interactive elements (buttons, links) inside
 * patterns that fire events. These become per-element source handles
 * so edges connect from the specific trigger element to the target screen.
 *
 * Uses @almadar/core types for schema-level constructs.
 */

import type { Node, Edge } from '@xyflow/react';
import type {
  OrbitalSchema,
  OrbitalDefinition,
  Trait,
  Transition,
  State,
  Effect,
  Entity,
  EntityCall,
  EntityData,
  JsonObject,
  Expression,
  UISlot,
} from '@almadar/core';
import { eventKeyPropsOf, eventListPropsOf, renderUiEntriesOf, type AnyPatternConfig } from '@almadar/core/patterns';
import { getStateRole, type StateRole } from './avl-theme';
import { collectEmbeddedTraits } from './embedded-traits';
import { traitEventWires, type TraitEventWire } from './avl-event-wires';

// ---------------------------------------------------------------------------
// View levels
// ---------------------------------------------------------------------------

/**
 * What a FlowCanvas lays out: `overview` — orbital cards (the focused one, or
 * all of them); `trait-expanded` — one card per trait of a single orbital,
 * wired by intra-orbital `emits → listens` edges (the cosmic tab's circuit).
 */
export type ViewLevel = 'overview' | 'trait-expanded' | 'system';

// ---------------------------------------------------------------------------
// Screen size presets for preview nodes
// ---------------------------------------------------------------------------

/**
 * Screen size preset for OrbPreview rendering inside nodes.
 *
 * Aligned with the four-breakpoint responsiveness audit:
 *   mobile  — phone portrait  (≤640px)
 *   tablet  — iPad / small landscape (641–1024px)
 *   laptop  — 13–15" notebook (1025–1440px)
 *   wide    — desktop / monitor (≥1441px)
 *
 * Preset widths are representative viewport widths within each range; the
 * preview renders at exactly this width so the embedded UI experiences
 * the same media-query / container-query behavior it would at the real
 * viewport. `minHeight` only floors the preview frame; vertical sizing is
 * content-driven (OrbPreview height="auto").
 */
export type ScreenSize = 'mobile' | 'tablet' | 'laptop' | 'wide';

export const SCREEN_SIZE_PRESETS: Record<ScreenSize, { width: number; minHeight: number; labelKey: string; icon: string }> = {
  mobile: { width: 375,  minHeight: 320, labelKey: 'screenSize.mobile', icon: 'smartphone' },
  tablet: { width: 768,  minHeight: 320, labelKey: 'screenSize.tablet', icon: 'tablet' },
  laptop: { width: 1280, minHeight: 360, labelKey: 'screenSize.laptop', icon: 'monitor' },
  wide:   { width: 1600, minHeight: 360, labelKey: 'screenSize.wide',   icon: 'monitor-up' },
};

/**
 * Map a raw viewport width (px) to the nearest preset. Used by FlowCanvas
 * to auto-pick the default ScreenSize based on the user's actual canvas
 * pane width on mount + on window resize. The breakpoint edges match the
 * responsiveness-audit tiers exactly (640 / 1024 / 1440) so what the
 * preview renders matches the tier the audit graded against.
 */
export function detectScreenSize(viewportWidth: number): ScreenSize {
  if (viewportWidth <= 640) return 'mobile';
  if (viewportWidth <= 1024) return 'tablet';
  if (viewportWidth <= 1440) return 'laptop';
  return 'wide';
}

// ---------------------------------------------------------------------------
// Event sources — UI elements that trigger transitions
// ---------------------------------------------------------------------------

/**
 * An interactive element inside a render-ui pattern that fires an event.
 * For example, a button with `event: "CHECKOUT"` is an event source.
 * These are used to draw edges from the specific trigger element to the
 * target screen, making the prototype flow concrete.
 */
export interface PatternEventSource {
  /** The event name fired by this element (e.g., "CHECKOUT"). */
  event: string;

  /** The pattern type of the trigger element (e.g., "button", "link", "icon-button"). */
  patternType: string;

  /** Human label if available (e.g., "Checkout", "Submit"). */
  label?: string;

  /**
   * Path within the pattern tree (e.g., "children.2" means third child).
   * Used to position the handle near the trigger element.
   */
  path: string;

  /** Vertical position hint (0..1) for handle placement on the node. */
  positionHint: number;

  /** Typed payload fields if this event carries data. */
  payloadFields?: Array<{ name: string; type: string; required?: boolean }>;
}

// ---------------------------------------------------------------------------
// Render-UI pattern entry
// ---------------------------------------------------------------------------

/** A slot + pattern config pair extracted from a render-ui effect. */
export interface RenderUIEntry {
  slot: string;
  pattern: AnyPatternConfig;
}

// ---------------------------------------------------------------------------
// React Flow node data
// ---------------------------------------------------------------------------

/**
 * Data for a preview node (used at both overview and expanded levels). A closed
 * type alias, not an index-signature interface: it stays assignable to React
 * Flow's `Record<string, unknown>` node-data bound while every field is declared.
 */
export type PreviewNodeData = {
  /** Orbital this node belongs to. */
  orbitalName: string;

  /** Trait name (a card showing a picked state). */
  traitName?: string;

  /** State name after this transition fires (a card showing a picked state). */
  stateName?: string;

  /** Event that triggers this transition (a card showing a picked state). */
  transitionEvent?: string;

  /** From state (a card showing a picked state). */
  fromState?: string;

  /** To state (a card showing a picked state). */
  toState?: string;

  /** The card frame's width set by the designer; the screen-size preset otherwise. */
  cardWidth?: number;

  /** `'screen'`: a designer card standing for every transition that paints this same render. */
  cardLabel?: 'screen';

  /** Screen cards: every event that shows this render, in declaration order. */
  enteredBy?: string[];

  /** The screen its trait shows when the app opens: entered by INIT fired from the trait's initial state. */
  opensApp?: boolean;

  /**
   * Render-ui patterns extracted from the transition's effects.
   * Each entry is a slot + pattern config pair.
   */
  patterns: RenderUIEntry[];

  /**
   * Interactive elements within the patterns that fire events.
   * Each one becomes a source handle on the node, allowing edges
   * to connect from the specific button/link to the target screen.
   */
  eventSources: PatternEventSource[];

  /** Behavior layer for visual indicator (color band). */
  layer?: string;

  /** State role for visual indicator. */
  stateRole?: StateRole;

  /** All effect types on this transition (for overlay). */
  effectTypes?: string[];

  /** Guard expression (for overlay). */
  guard?: Expression | null;

  // --- Orbital metadata (for overlay at overview level) ---
  entityName?: string;
  persistence?: string;
  fieldCount?: number;
  traitCount?: number;
  pageRoutes?: string[];

  /**
   * Generation status for this orbital. When `'running'`, the overview node
   * renders a spinner overlay + accent border so the user can see which
   * orbital the coordinator is currently dispatching to. Other states are
   * available so consumers can also paint success/error treatments
   * (e.g. green border on completion, red on failure). Default is `'idle'`.
   *
   * Set by FlowCanvasProps.orbitalStatus and threaded through the converter.
   * Future expansion: hover over a `'running'` node to surface the subagent
   * trace inline.
   */
  status?: 'idle' | 'running' | 'success' | 'error';

  /**
   * The `OrbitalSchema.name` this node was derived from. The reserved value
   * `'__design_system__'` identifies nodes belonging to the Design System
   * tab's synthesized catalog schema, so downstream event handlers can route
   * mutation events to the project theme manifest instead of the project's
   * orbital schema. Unset for project orbitals — handlers treat absence as
   * "project schema".
   */
  sourceSchemaName?: string;

  /** World view: this card is the focused orbital. */
  focused?: boolean;

  /**
   * Discriminator for the node variant. Absent on orbital cards (a card
   * showing a picked state carries `transitionEvent`). Set to `'trait-card'` for nodes
   * produced by `orbitalToTraitGraph` so renderers can branch cleanly.
   */
  kind?: 'trait-card' | 'system-orbital' | 'system-band' | 'dependency' | 'dependency-column';

  /** `dependency` / `dependency-column`: the column the node sits in (the app, or the layer it is imported from). */
  dependencyColumn?: 'app' | 'own' | 'io' | 'std' | 'primitive' | 'unknown' | 'client' | 'host' | 'service' | 'store' | 'external';
  /** `dependency`: its part in the current selection (`both`: on each side of it). */
  dependencyRole?: 'selected' | 'upstream' | 'downstream' | 'both' | 'dim';
  /** Trait flow: a composed unit's traits and embedded render pieces. */
  flowTraits?: number;
  flowRenderPieces?: number;
  /** `dependency`: a live unit's health (the infrastructure view), and one metric to show beside it. */
  unitStatus?: 'ok' | 'degraded' | 'down' | 'idle';
  unitMetric?: string;

  /** `system-band`: which band the label heads, and how many orbitals it holds. */
  bandKind?: 'connected' | 'standalone';
  bandCount?: number;

  /** `system-orbital`: the events this orbital exchanges with others (in and out), for search. */
  wireEvents?: string[];

  /**
   * Trait-card transitions (`kind === 'trait-card'` only). One row per
   * transition; each row is clickable and drills to L4 transition detail
   * in cosmic. `event` is the trigger; `fromState` / `toState` mirror the
   * underlying state-machine edge.
   */
  transitions?: Array<{ event: string; fromState: string; toState: string }>;

  /**
   * Trait-card `emits` event names (`kind === 'trait-card'` only). One
   * source handle per entry on the right edge of the card. Drives the
   * outgoing wire endpoints in `orbitalToTraitGraph`.
   */
  emits?: string[];

  /**
   * Trait-card `listens` event names (`kind === 'trait-card'` only). One
   * target handle per entry on the left edge of the card. Drives the
   * incoming wire endpoints in `orbitalToTraitGraph`.
   */
  listens?: string[];

  /**
   * Trait-card `linkedEntity` (`kind === 'trait-card'` only). Surfaced as a
   * subtitle/badge next to the trait name so users can see what entity the
   * trait operates on. Mirrors `Trait.linkedEntity` from the resolved schema.
   */
  linkedEntity?: string;

  /** Full parsed schema threaded to node renderers (e.g. TraitCardNode). */
  _fullSchema?: OrbitalSchema;

  /** Mock entity data for the orbital preview. */
  _mockData?: EntityData;
};

// ---------------------------------------------------------------------------
// React Flow edge data
// ---------------------------------------------------------------------------

/** Data for event flow edges. */
export interface EventEdgeData {
  [key: string]: string | boolean | undefined;

  /** The event name displayed on the edge. */
  event: string;

  /** Source state name (expanded level). */
  fromState?: string;

  /** Target state name (expanded level). */
  toState?: string;

  /** Whether this is a backward/retry transition. */
  isBackward?: boolean;

  /** Whether this is a cross-orbital event wire (overview level). */
  isCrossOrbital?: boolean;

  /** Source trait (for cross-orbital wires). */
  fromTrait?: string;

  /** Target trait (for cross-orbital wires). */
  toTrait?: string;

  /**
   * The pattern type that triggers this event (e.g., "button").
   * Displayed on the edge label for context.
   */
  triggerPatternType?: string;

  /** The trigger element's label (e.g., "Checkout"). */
  triggerLabel?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Card-to-card gap between preview nodes, on top of the preset width/height.
// Wide enough that cards read as separate units; not so wide that the L1
// grid sprawls past one viewport.
const OVERVIEW_GAP_X = 160;
const OVERVIEW_GAP_Y = 240;

// Card chrome (header bar + name strip + footer) on top of the device preset's
// `minHeight`. Keeps Y spacing honest even when the preset reports a short
// preview height.
const CARD_CHROME_Y = 120;

/**
 * Compute non-overlapping grid spacing for a given screen-size preset.
 * Each cell = preset.width × (preset.minHeight + chrome) + gap on both axes,
 * so cards at any preset (mobile → wide) get the same visual breathing room.
 *
 * `screenSize` is optional and defaults to `'wide'` — the widest preset —
 * so legacy callers that don't pass it are guaranteed not to overlap.
 */
function computeSpacing(screenSize: ScreenSize = 'wide'): { x: number; y: number } {
  const preset = SCREEN_SIZE_PRESETS[screenSize];
  return {
    x: preset.width + OVERVIEW_GAP_X,
    y: preset.minHeight + CARD_CHROME_Y + OVERVIEW_GAP_Y,
  };
}

/** Pattern types that can fire events via their `event` prop. */
const EVENT_FIRING_PATTERNS = new Set([
  'button', 'icon-button', 'link', 'menu-item', 'action-button',
  'float-button', 'input', 'select', 'checkbox', 'radio',
  'card', 'list-item', 'tab', 'breadcrumb-item',
]);

// ---------------------------------------------------------------------------
// Schema accessors (safe access to possibly-untyped schema data)
// ---------------------------------------------------------------------------

function getOrbitals(schema: OrbitalSchema): OrbitalDefinition[] {
  return schema.orbitals ?? [];
}

function getTraits(orbital: OrbitalDefinition): Trait[] {
  if (!orbital.traits) return [];
  return orbital.traits.map(t => {
    if (typeof t === 'string') return { name: t } as Trait;
    if (typeof t === 'object' && t !== null && 'ref' in t) return { name: (t as { ref: string }).ref } as Trait;
    return t as Trait;
  });
}

function getStateMachine(trait: Trait): { states: State[]; transitions: Transition[] } | null {
  const sm = trait.stateMachine;
  if (!sm) return null;
  return {
    states: (sm.states ?? []) as State[],
    transitions: (sm.transitions ?? []) as Transition[],
  };
}

function getEntityInfo(orbital: OrbitalDefinition): { name: string; persistence: string; fieldCount: number } {
  const entity = orbital.entity;
  if (typeof entity === 'string') {
    return { name: entity, persistence: 'runtime', fieldCount: 0 };
  }
  const e = entity as Entity | EntityCall;
  const fields = e.fields ?? [];
  return {
    name: e.name ?? orbital.name,
    persistence: e.persistence ?? 'runtime',
    fieldCount: fields.length,
  };
}

function getPages(orbital: OrbitalDefinition): string[] {
  if (!orbital.pages) return [];
  return orbital.pages.map(p => {
    if (typeof p === 'string') return `/${p.toLowerCase()}`;
    if ('ref' in p) return p.path ?? `/${p.ref}`.toLowerCase();
    return p.path ?? `/${p.name}`.toLowerCase();
  });
}

function getEmits(trait: Trait): string[] {
  const emits = trait.emits as Array<{ event: string } | string> | undefined;
  if (!emits) return [];
  return emits.map(e => typeof e === 'string' ? e : e.event ?? '');
}

function getListens(trait: Trait): string[] {
  const listens = trait.listens as Array<{ event: string } | string> | undefined;
  if (!listens) return [];
  return listens.map(l => typeof l === 'string' ? l : l.event ?? '');
}

// ---------------------------------------------------------------------------
// Render-UI extraction
// ---------------------------------------------------------------------------

/** Every render-ui a transition performs (nested ones included), as preview entries. */
function extractRenderUI(effects: Effect[]): RenderUIEntry[] {
  return renderUiEntriesOf(effects).map(({ slot, pattern }) => ({ slot, pattern: pattern as AnyPatternConfig }));
}

/** Extract effect type names from an effects array. */
function extractEffectTypes(effects: Effect[]): string[] {
  const types = new Set<string>();
  for (const eff of effects) {
    if (Array.isArray(eff) && typeof eff[0] === 'string') {
      types.add(eff[0]);
    }
  }
  return Array.from(types);
}

// ---------------------------------------------------------------------------
// Event source detection — find buttons/links that fire events
// ---------------------------------------------------------------------------

/**
 * Recursively scan a pattern config tree for elements with an `event` prop.
 * Returns all interactive elements that fire state machine events.
 *
 * Example: { type: "button", label: "Checkout", event: "CHECKOUT" }
 * → PatternEventSource { event: "CHECKOUT", patternType: "button", label: "Checkout" }
 */
function findEventSources(
  config: JsonObject,
  path = 'root',
  depth = 0,
  totalSiblings = 1,
  siblingIndex = 0,
): PatternEventSource[] {
  const sources: PatternEventSource[] = [];
  if (depth > 10) return sources; // Prevent infinite recursion

  const patternType = typeof config.type === 'string' ? config.type : undefined;

  // The events this element fires: the props the registry declares as event
  // outlets, and each item of its event-list (action) props.
  const events: string[] = [];
  if (patternType) {
    for (const prop of eventKeyPropsOf(patternType)) {
      const value = config[prop];
      if (typeof value === 'string' && value) events.push(value);
    }
    for (const [prop, field] of eventListPropsOf(patternType)) {
      const items = config[prop];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
        const value = (item as JsonObject)[field];
        if (typeof value === 'string' && value) events.push(value);
      }
    }
  }
  if (patternType && events.length > 0) {
    // A vertical position hint from the element's depth and index, so the
    // source handle sits near the trigger element.
    const positionHint = totalSiblings > 1
      ? (siblingIndex + 0.5) / totalSiblings
      : 0.5 + (depth * 0.1);
    const label = typeof config.label === 'string' ? config.label : typeof config.content === 'string' ? config.content : typeof config.text === 'string' ? config.text : undefined;
    for (const event of events) {
      sources.push({ event, patternType, label, path, positionHint: Math.min(Math.max(positionHint, 0.1), 0.9) });
    }
  }

  // Recurse into children
  const children = config.children;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
        sources.push(
          ...findEventSources(child as JsonObject, `${path}.children.${i}`, depth + 1, children.length, i),
        );
      }
    }
  }

  // Recurse into named props that might be pattern configs (e.g., flip-card front/back)
  for (const [key, value] of Object.entries(config)) {
    if (key === 'children' || key === 'type') continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && 'type' in value) {
      sources.push(
        ...findEventSources(value as JsonObject, `${path}.${key}`, depth + 1, totalSiblings, siblingIndex),
      );
    }
  }

  return sources;
}

/** Collect all event sources across all patterns in a node. */
function collectEventSources(patterns: RenderUIEntry[]): PatternEventSource[] {
  const allSources: PatternEventSource[] = [];
  for (const entry of patterns) {
    allSources.push(...findEventSources(entry.pattern as JsonObject));
  }
  // Deduplicate by event name (keep first occurrence)
  const seen = new Set<string>();
  return allSources.filter(s => {
    if (seen.has(s.event)) return false;
    seen.add(s.event);
    return true;
  });
}

// ---------------------------------------------------------------------------
// State role detection
// ---------------------------------------------------------------------------

function detectStateRole(
  stateName: string,
  states: State[],
  transitions: Transition[],
): StateRole {
  const stateInfo = states.find(s => s.name === stateName);
  const counts = new Map<string, number>();
  for (const t of transitions) {
    counts.set(t.from, (counts.get(t.from) ?? 0) + 1);
    counts.set(t.to, (counts.get(t.to) ?? 0) + 1);
  }
  const maxCount = Math.max(0, ...counts.values());
  return getStateRole(stateInfo?.isInitial, stateInfo?.isTerminal || stateInfo?.isFinal, counts.get(stateName) ?? 0, maxCount);
}

// ---------------------------------------------------------------------------
// Emit/listen matching — shared by overview (cross-orbital) and trait-graph
// (intra-orbital). `scope` decides whether emitter and listener must be in
// the SAME orbital or in DIFFERENT orbitals.
// ---------------------------------------------------------------------------

/** Trait wires the runtime delivers (`traitEventWires`), one per (emitter, listener, event) at the scope's grain. */
function extractTraitWires(
  orbitals: OrbitalDefinition[],
  scope: 'intra-orbital' | 'cross-orbital',
): TraitEventWire[] {
  const seen = new Set<string>();
  return traitEventWires({ name: '', orbitals }).filter((w) => {
    const cross = w.emitterOrbital !== w.listenerOrbital;
    if (cross !== (scope === 'cross-orbital')) return false;
    const key = cross
      ? `${w.emitterOrbital}\u241f${w.listenerOrbital}\u241f${w.event}`
      : `${w.emitterOrbital}\u241f${w.emitterTrait}\u241f${w.listenerTrait}\u241f${w.event}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Level 1: Overview graph (one node per orbital)
// ---------------------------------------------------------------------------

/**
 * Build a React Flow graph for the overview level.
 * Each orbital gets one node showing its INIT transition's UI.
 */
export function schemaToOverviewGraph(
  schema: OrbitalSchema,
  mockData?: EntityData,
  behaviorMeta?: Record<string, { layer: string }>,
  layoutHint?: 'pipeline' | 'grid',
  orbitalStatus?: Record<string, PreviewNodeData['status']>,
  screenSize?: ScreenSize,
): {
  nodes: Node<PreviewNodeData>[];
  edges: Edge<EventEdgeData>[];
} {
  const orbitals = getOrbitals(schema);
  const nodes: Node<PreviewNodeData>[] = [];
  const edges: Edge<EventEdgeData>[] = [];

  const count = orbitals.length;
  const cols = layoutHint === 'pipeline' ? count : Math.ceil(Math.sqrt(count));
  const spacing = computeSpacing(screenSize);

  for (let i = 0; i < orbitals.length; i++) {
    const orb = orbitals[i];
    const entityInfo = getEntityInfo(orb);
    const pageRoutes = getPages(orb);
    const traits = getTraits(orb);

    // Find INIT transition with render-ui across all traits
    let initPatterns: RenderUIEntry[] = [];
    let initEffectTypes: string[] = [];

    for (const trait of traits) {
      const sm = getStateMachine(trait);
      if (!sm) continue;

      const initT = sm.transitions.find(t => t.event === 'INIT');
      if (initT?.effects) {
        const patterns = extractRenderUI(initT.effects);
        if (patterns.length > 0) {
          initPatterns = patterns;
          initEffectTypes = extractEffectTypes(initT.effects);
          break;
        }
      }
    }

    // Fallback: first transition with render-ui
    if (initPatterns.length === 0) {
      for (const trait of traits) {
        const sm = getStateMachine(trait);
        if (!sm) continue;
        for (const t of sm.transitions) {
          if (t.effects) {
            const patterns = extractRenderUI(t.effects);
            if (patterns.length > 0) {
              initPatterns = patterns;
              initEffectTypes = extractEffectTypes(t.effects);
              break;
            }
          }
        }
        if (initPatterns.length > 0) break;
      }
    }

    const eventSources = collectEventSources(initPatterns);

    // Enrich event sources with typed payload fields from state machine events
    for (const source of eventSources) {
      for (const trait of traits) {
        const sm = getStateMachine(trait);
        if (!sm) continue;
        const smEvents = trait.stateMachine?.events ?? [];
        const matchingEvent = smEvents.find(ev => ev.key === source.event);
        if (matchingEvent?.payloadSchema && Array.isArray(matchingEvent.payloadSchema)) {
          source.payloadFields = matchingEvent.payloadSchema.map(p => ({
            name: p.name ?? '',
            type: p.type ?? 'string',
            ...(p.required ? { required: true as const } : {}),
          }));
          break;
        }
      }
    }

    const col = i % cols;
    const row = Math.floor(i / cols);

    nodes.push({
      id: orb.name,
      type: 'preview',
      position: { x: col * spacing.x, y: row * spacing.y },
      data: {
        orbitalName: orb.name,
        patterns: initPatterns,
        eventSources,
        effectTypes: initEffectTypes,
        layer: behaviorMeta?.[orb.name]?.layer,
        stateRole: 'initial',
        entityName: entityInfo.name,
        persistence: entityInfo.persistence,
        fieldCount: entityInfo.fieldCount,
        traitCount: traits.length,
        pageRoutes,
        status: orbitalStatus?.[orb.name] ?? 'idle',
        _fullSchema: schema,
        _mockData: mockData,
      },
    });
  }

  // Cross-orbital event wire edges
  for (const link of extractTraitWires(orbitals, 'cross-orbital')) {
    // Try to find the trigger element in the source orbital's patterns
    const sourceNode = nodes.find(n => n.id === link.emitterOrbital);
    const sourceData = sourceNode?.data as PreviewNodeData | undefined;
    const triggerSource = sourceData?.eventSources.find(s => s.event === link.event);

    edges.push({
      id: `ew-${link.emitterOrbital}-${link.listenerOrbital}-${link.event}`,
      source: link.emitterOrbital,
      target: link.listenerOrbital,
      sourceHandle: triggerSource ? `event-${link.event}` : undefined,
      type: 'eventFlow',
      data: {
        event: link.event,
        isCrossOrbital: true,
        fromTrait: link.emitterTrait,
        toTrait: link.listenerTrait,
        triggerPatternType: triggerSource?.patternType,
        triggerLabel: triggerSource?.label,
      },
    });
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Card states: the options of a card's state dropdown
// ---------------------------------------------------------------------------

/** Internal: a transition + its trait context, ready for card data. */
interface UITransitionEntry {
  trait: Trait;
  traitName: string;
  transition: Transition;
  patterns: RenderUIEntry[];
  eventSources: PatternEventSource[];
  states: State[];
  allTransitions: Transition[];
}

/** Every transition of the orbital's matching traits that has at least one `render-ui` effect. */
function collectUITransitions(
  orbital: OrbitalDefinition,
  filter: (trait: Trait) => boolean,
): UITransitionEntry[] {
  const out: UITransitionEntry[] = [];
  for (const trait of getTraits(orbital)) {
    if (!filter(trait)) continue;
    const sm = getStateMachine(trait);
    if (!sm) continue;
    for (const t of sm.transitions) {
      if (!t.effects) continue;
      const patterns = extractRenderUI(t.effects);
      if (patterns.length === 0) continue;
      out.push({
        trait,
        traitName: trait.name,
        transition: t,
        patterns,
        eventSources: collectEventSources(patterns),
        states: sm.states,
        allTransitions: sm.transitions,
      });
    }
  }
  return out;
}

/** How a card's states are listed: one per render-ui transition, or one per distinct render (designer). */
export type CanvasStateView = 'transitions' | 'screens';

/** The state-dropdown entry that shows the whole orbital running from its initial state. */
export const LIVE_STATE = 'live';

export interface CanvasStateOption {
  id: string;
  label: string;
  hint: string;
  data: PreviewNodeData;
}

export interface CanvasStateGroup {
  alias: string;
  behaviorName: string;
  options: CanvasStateOption[];
}

export interface CanvasStateOptions {
  own: CanvasStateOption[];
  groups: CanvasStateGroup[];
}

interface ScreenEntry {
  entry: UITransitionEntry;
  enteredBy: string[];
  /** One of its transitions is INIT fired from the trait's initial state: what the trait shows when the app opens. */
  opensApp: boolean;
}

/** Whether a transition is the INIT a trait runs when the app opens: fired from its initial state. */
function opensApp(entry: UITransitionEntry): boolean {
  if (entry.transition.event !== 'INIT') return false;
  const initial = entry.states.find((st) => st.isInitial)?.name;
  const from = entry.transition.from;
  return initial !== undefined && (Array.isArray(from) ? from.includes(initial) : from === initial);
}

/**
 * Collapse a trait's transitions whose rendered output is identical into one
 * screen, keeping declaration order and recording every event that shows it.
 * Different renders of the same state (spinner / list / error) stay apart.
 */
function collapseToScreens(transitions: UITransitionEntry[]): ScreenEntry[] {
  const screens: ScreenEntry[] = [];
  const byRender = new Map<string, ScreenEntry>();
  for (const entry of transitions) {
    const key = `${entry.traitName}|${JSON.stringify(entry.patterns)}`;
    const screen = byRender.get(key);
    if (screen) {
      screen.enteredBy.push(entry.transition.event);
      screen.opensApp = screen.opensApp || opensApp(entry);
      continue;
    }
    const fresh = { entry, enteredBy: [entry.transition.event], opensApp: opensApp(entry) };
    byRender.set(key, fresh);
    screens.push(fresh);
  }
  return screens;
}

function stateOptionsFor(
  schema: OrbitalSchema,
  orbitalName: string,
  entityName: string,
  transitions: UITransitionEntry[],
  view: CanvasStateView,
  mockData?: EntityData,
): CanvasStateOption[] {
  const screens: ScreenEntry[] = view === 'screens'
    ? collapseToScreens(transitions)
    : transitions.map((entry) => ({ entry, enteredBy: [entry.transition.event], opensApp: opensApp(entry) }));
  // A list spanning several traits names each entry's trait; within one trait a
  // state shown by several distinct renders is told apart by its event.
  const manyTraits = new Set(screens.map((s) => s.entry.traitName)).size > 1;
  const stateUses = new Map<string, number>();
  for (const s of screens) {
    const key = `${s.entry.traitName}|${s.entry.transition.to}`;
    stateUses.set(key, (stateUses.get(key) ?? 0) + 1);
  }
  // Guarded arms of one transition (same trait/event/from/to) are separate
  // options: the first keeps the plain id, the nth gets `#n` + "(guard n)".
  const armsSeen = new Map<string, number>();
  return screens.map(({ entry, enteredBy, opensApp: opens }) => {
    const t = entry.transition;
    const from = String(t.from);
    const state = view === 'screens'
      ? ((stateUses.get(`${entry.traitName}|${t.to}`) ?? 0) > 1 ? `${t.to} · ${t.event}` : t.to)
      : `${t.event}: ${from} → ${t.to}`;
    const baseId = `${entry.traitName}:${t.event}:${from}:${t.to}`;
    const arm = (armsSeen.get(baseId) ?? 0) + 1;
    armsSeen.set(baseId, arm);
    const named = manyTraits ? `${entry.traitName} · ${state}` : state;
    const label = arm > 1 ? `${named} (guard ${arm})` : named;
    return {
      id: arm > 1 ? `${baseId}#${arm}` : baseId,
      label,
      hint: view === 'screens' ? enteredBy.join(' · ') : entry.traitName,
      data: {
        orbitalName,
        traitName: entry.traitName,
        stateName: t.to,
        transitionEvent: t.event,
        fromState: from,
        toState: t.to,
        opensApp: opens,
        patterns: entry.patterns,
        eventSources: entry.eventSources,
        stateRole: detectStateRole(t.to, entry.states, entry.allTransitions),
        effectTypes: t.effects ? extractEffectTypes(t.effects) : [],
        guard: t.guard,
        entityName,
        _fullSchema: schema,
        _mockData: mockData,
        ...(view === 'screens' ? { cardLabel: 'screen' as const, enteredBy } : {}),
      },
    };
  });
}

/**
 * The states a card can show: the orbital's own render-ui transitions, plus
 * one group per imported behavior (`sourceBehavior.alias`). A trait embedded
 * in another trait's render (`@trait.X`) draws inside that screen, so it is
 * not a state of its own.
 */
export function stateOptionsOf(
  schema: OrbitalSchema,
  orbitalName: string,
  view: CanvasStateView,
  mockData?: EntityData,
): CanvasStateOptions {
  const orbital = getOrbitals(schema).find(o => o.name === orbitalName);
  if (!orbital) return { own: [], groups: [] };
  const entityName = getEntityInfo(orbital).name;
  const embedded = collectEmbeddedTraits({ ...schema, orbitals: [orbital] });
  const own = stateOptionsFor(
    schema, orbitalName, entityName,
    collectUITransitions(orbital, (trait) => trait.sourceBehavior === undefined && !embedded.has(trait.name)),
    view, mockData,
  );
  const aliases = new Map<string, string>();
  for (const trait of getTraits(orbital)) {
    if (embedded.has(trait.name)) continue;
    if (trait.sourceBehavior && !aliases.has(trait.sourceBehavior.alias)) {
      aliases.set(trait.sourceBehavior.alias, trait.sourceBehavior.behavior);
    }
  }
  const groups = [...aliases].flatMap(([alias, behaviorName]) => {
    const options = stateOptionsFor(
      schema, orbitalName, entityName,
      collectUITransitions(orbital, (trait) => trait.sourceBehavior?.alias === alias && !embedded.has(trait.name)),
      view, mockData,
    );
    return options.length > 0 ? [{ alias, behaviorName, options }] : [];
  });
  return { own, groups };
}

/**
 * The state a card opens on: an INIT render (own, then an imported behavior's)
 * — the screen the app actually opens on — else its first state, else the
 * live orbital.
 */
export function initialStateOf(options: CanvasStateOptions): string {
  const isInit = (o: CanvasStateOption) => o.data.opensApp === true;
  const groupOptions = options.groups.flatMap((g) => g.options);
  const pick = options.own.find(isInit) ?? groupOptions.find(isInit) ?? options.own[0] ?? groupOptions[0];
  return pick?.id ?? LIVE_STATE;
}

/** One transition a verification run played on a card's trait. */
export interface PlayedStep {
  trait: string;
  event: string;
  from: string;
  to: string;
}

/**
 * The card option showing where a played step landed: the option for exactly that transition,
 * else the trait's first screen of the state it reached. `undefined` when the state has no
 * screen of its own (the card then stays as it is).
 */
export function optionForPlayedStep(options: CanvasStateOptions, step: PlayedStep): string | undefined {
  const all = [...options.own, ...options.groups.flatMap((g) => g.options)];
  const exact = all.find((o) => o.id === `${step.trait}:${step.event}:${step.from}:${step.to}`);
  if (exact) return exact.id;
  return all.find((o) => o.data.traitName === step.trait && o.data.toState === step.to)?.id;
}

/** What the viewport frames: fitting follows this, never the schema's content. */
export interface CanvasViewport {
  scope: 'local' | 'world';
  focusedOrbital: string | undefined;
  screenSize: ScreenSize;
  /** Which lens of the system map or trait level is framed (a new lens re-fits); absent on the canvas levels. */
  level?: string;
}

/** True when the framed view changed (or there was none yet) — a schema update alone is not a change. */
export function canvasViewChanged(previous: CanvasViewport | null, next: CanvasViewport): boolean {
  return (
    previous === null ||
    previous.scope !== next.scope ||
    previous.focusedOrbital !== next.focusedOrbital ||
    previous.screenSize !== next.screenSize ||
    previous.level !== next.level
  );
}

export interface CanvasViewOptions {
  /** `local`: the focused orbital's card only; `world`: every orbital's card. */
  scope: 'local' | 'world';
  focusedOrbital?: string;
  /** Each card's dropdown choice (a `CanvasStateOption.id`); its `initialStateOf` when absent or gone. */
  stateByOrbital?: Record<string, string>;
  view: CanvasStateView;
  mockData?: EntityData;
  behaviorMeta?: Record<string, { layer: string }>;
  layoutHint?: 'pipeline' | 'grid';
  orbitalStatus?: Record<string, PreviewNodeData['status']>;
  screenSize?: ScreenSize;
}

/** The canvas's cards and edges for a scope, each card showing its chosen state. */
export function canvasViewGraph(
  schema: OrbitalSchema,
  opts: CanvasViewOptions,
): {
  nodes: Node<PreviewNodeData>[];
  edges: Edge<EventEdgeData>[];
  focusedOrbital: string | undefined;
  /** Every card's world-view layout position (the local view draws its one card at the origin). */
  worldPositions: Record<string, { x: number; y: number }>;
} {
  const overview = schemaToOverviewGraph(schema, opts.mockData, opts.behaviorMeta, opts.layoutHint, opts.orbitalStatus, opts.screenSize);
  const ids = overview.nodes.map((n) => n.id);
  const worldPositions = Object.fromEntries(overview.nodes.map((n) => [n.id, n.position]));
  const focusedOrbital = opts.focusedOrbital !== undefined && ids.includes(opts.focusedOrbital)
    ? opts.focusedOrbital
    : ids[0];
  const withState = overview.nodes.map((node): Node<PreviewNodeData> => {
    const options = stateOptionsOf(schema, node.id, opts.view, opts.mockData);
    const all = [...options.own, ...options.groups.flatMap((g) => g.options)];
    const asked = opts.stateByOrbital?.[node.id];
    const chosen = asked === LIVE_STATE || all.some((o) => o.id === asked) ? asked : initialStateOf(options);
    const picked = all.find((o) => o.id === chosen);
    const data = picked ? { ...node.data, ...picked.data } : node.data;
    return { ...node, data: { ...data, focused: opts.scope === 'world' && node.id === focusedOrbital } };
  });
  if (opts.scope === 'local') {
    const focused = withState.filter((n) => n.id === focusedOrbital).map((n) => ({ ...n, position: { x: 0, y: 0 } }));
    return { nodes: focused, edges: [], focusedOrbital, worldPositions };
  }
  const byId = new Map(withState.map((n) => [n.id, n]));
  const edges = overview.edges.map((edge) => {
    const event = edge.data?.event;
    const renders = event !== undefined && byId.get(edge.source)?.data.eventSources.some((s) => s.event === event);
    return renders ? edge : { ...edge, sourceHandle: undefined };
  });
  return { nodes: withState, edges, focusedOrbital, worldPositions };
}

// ---------------------------------------------------------------------------
// Trait-expanded graph: one card per trait of one orbital
// ---------------------------------------------------------------------------

const TRAIT_CARD_SPACING_X = 480;
const TRAIT_CARD_SPACING_Y = 380;

/** The system map's chip size and spacing (cosmic L1). */
export const SYSTEM_CHIP = { width: 280, height: 88, gapX: 160, gapY: 36, bandGap: 72, bandLabel: 36 };

/**
 * The whole app as a system map (cosmic L1): one chip per orbital, one edge
 * per orbital pair the runtime delivers events across (`traitEventWires`).
 * Connected orbitals flow left to right by event direction; orbitals that
 * exchange nothing sit in a grid band below, so any number of orbitals stays
 * legible.
 */
export function schemaToSystemGraph(schema: OrbitalSchema): { nodes: Node<PreviewNodeData>[]; edges: Edge<EventEdgeData>[] } {
  const orbitals = getOrbitals(schema);
  const pairs = new Map<string, { source: string; target: string; events: string[] }>();
  const eventsOf = new Map<string, Set<string>>();
  for (const w of extractTraitWires(orbitals, 'cross-orbital')) {
    const key = `${w.emitterOrbital}\u241f${w.listenerOrbital}`;
    const pair = pairs.get(key) ?? { source: w.emitterOrbital, target: w.listenerOrbital, events: [] };
    if (!pair.events.includes(w.event)) pair.events.push(w.event);
    pairs.set(key, pair);
    for (const o of [w.emitterOrbital, w.listenerOrbital]) eventsOf.set(o, (eventsOf.get(o) ?? new Set()).add(w.event));
  }

  // Longest-path layering over the wires; a cycle stops growing after |V| rounds.
  const connected = orbitals.filter((o) => eventsOf.has(o.name)).map((o) => o.name);
  const layer = new Map(connected.map((n) => [n, 0]));
  for (let round = 0; round < connected.length; round++) {
    let moved = false;
    for (const { source, target } of pairs.values()) {
      const next = (layer.get(source) ?? 0) + 1;
      if (source !== target && next < connected.length && next > (layer.get(target) ?? 0)) {
        layer.set(target, next);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const { width: W, height: H, gapX, gapY, bandGap, bandLabel } = SYSTEM_CHIP;
  const nodes: Node<PreviewNodeData>[] = [];
  const band = (bandKind: 'connected' | 'standalone', count: number, y: number): void => {
    nodes.push({
      id: `__band_${bandKind}`,
      type: 'systemBand',
      position: { x: 0, y },
      draggable: false,
      selectable: false,
      data: { orbitalName: `__band_${bandKind}`, kind: 'system-band', bandKind, bandCount: count, patterns: [], eventSources: [] },
    });
  };
  const chip = (orb: OrbitalDefinition, x: number, y: number): void => {
    const entity = getEntityInfo(orb);
    nodes.push({
      id: orb.name,
      type: 'system',
      position: { x, y },
      data: {
        orbitalName: orb.name,
        kind: 'system-orbital',
        entityName: entity.name,
        persistence: entity.persistence,
        fieldCount: entity.fieldCount,
        traitCount: getTraits(orb).length,
        pageRoutes: getPages(orb),
        wireEvents: [...(eventsOf.get(orb.name) ?? [])],
        patterns: [],
        eventSources: [],
      },
    });
  };

  let y = 0;
  if (connected.length > 0) {
    band('connected', connected.length, y);
    y += bandLabel;
    const rows = new Map<number, number>();
    let bottom = y;
    for (const name of connected) {
      const l = layer.get(name) ?? 0;
      const row = rows.get(l) ?? 0;
      rows.set(l, row + 1);
      const orb = orbitals.find((o) => o.name === name);
      if (!orb) continue;
      chip(orb, l * (W + gapX), y + row * (H + gapY));
      bottom = Math.max(bottom, y + row * (H + gapY) + H);
    }
    y = bottom + bandGap;
  }
  const standalone = orbitals.filter((o) => !eventsOf.has(o.name));
  if (standalone.length > 0) {
    band('standalone', standalone.length, y);
    y += bandLabel;
    // Columns for a landscape grid (about 1.6 wide per tall) of chip cells.
    const cellW = W + gapX / 4;
    const cellH = H + gapY;
    const cols = Math.max(1, Math.ceil(Math.sqrt((standalone.length * 1.6 * cellH) / cellW)));
    standalone.forEach((orb, i) => chip(orb, (i % cols) * cellW, y + Math.floor(i / cols) * cellH));
  }

  const edges: Edge<EventEdgeData>[] = [...pairs.values()].map((p) => ({
    id: `sys-${p.source}-${p.target}`,
    source: p.source,
    target: p.target,
    type: 'eventFlow',
    data: { event: p.events.join(', '), isCrossOrbital: true },
  }));
  return { nodes, edges };
}

/**
 * Build a React Flow graph for the `trait-expanded` level: one node per
 * trait of `orbitalName`, with intra-orbital `emits → listens` edges
 * between trait cards (an emit on trait A connects to a listen for the
 * same event on trait B in the same orbital).
 *
 * Used by the cosmic tab at L3 (after the user drills into an orbital
 * from the L1 grid). The canvas tab does not call this today; the new
 * level is opt-in via `initialLevel="trait-expanded"`.
 *
 * Layout: grid (`ceil(sqrt(N))` cols). Nodes are `type: 'traitCard'`
 * with `data.kind === 'trait-card'` so `FlowCanvas`'s NODE_TYPES routes
 * them to `TraitCardNode`.
 */
export function orbitalToTraitGraph(
  schema: OrbitalSchema,
  orbitalName: string,
  // mockData is reserved for parity with the other converters — the trait
  // card currently doesn't render mock rows but accepting the same prop
  // keeps consumer call sites uniform.
  _mockData?: EntityData,
): {
  nodes: Node<PreviewNodeData>[];
  edges: Edge<EventEdgeData>[];
} {
  const orbital = getOrbitals(schema).find(o => o.name === orbitalName);
  if (!orbital) return { nodes: [], edges: [] };

  const traits = getTraits(orbital);
  const nodes: Node<PreviewNodeData>[] = [];

  const count = traits.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));

  for (let i = 0; i < traits.length; i++) {
    const trait = traits[i];
    const sm = getStateMachine(trait);
    const transitions = (sm?.transitions ?? []).map(t => ({
      event: t.event,
      fromState: Array.isArray(t.from) ? t.from.join('|') : t.from,
      toState: t.to,
    }));
    const emits = getEmits(trait);
    const listens = getListens(trait);
    const linkedEntity = trait.linkedEntity ?? '';

    const row = Math.floor(i / cols);
    const col = i % cols;

    nodes.push({
      id: `trait-${orbitalName}-${trait.name}`,
      type: 'traitCard',
      position: {
        x: col * TRAIT_CARD_SPACING_X,
        y: row * TRAIT_CARD_SPACING_Y,
      },
      data: {
        kind: 'trait-card',
        orbitalName,
        traitName: trait.name,
        linkedEntity,
        transitions,
        emits,
        listens,
        // `_fullSchema` carries the parsed schema to `TraitCardNode` so it
        // can run `parseTraitLevel(...)` and render the ELK-laid-out
        // state-machine flow chart inside the card. Mirrors the same
        // convention `OrbPreviewNode` uses for its embedded UI preview.
        _fullSchema: schema,
        // Required fields on PreviewNodeData — keep empty for trait cards.
        patterns: [],
        eventSources: [],
      },
    });
  }

  // Intra-orbital edges: emitter trait → listener trait, one edge per
  // (emitTrait, listenTrait, event) triple. Scoped to `orbitalName` only.
  const wires = extractTraitWires([orbital], 'intra-orbital');
  const edges: Edge<EventEdgeData>[] = wires.map(w => ({
    id: `wire-${orbitalName}-${w.emitterTrait}-${w.listenerTrait}-${w.event}`,
    source: `trait-${orbitalName}-${w.emitterTrait}`,
    target: `trait-${orbitalName}-${w.listenerTrait}`,
    sourceHandle: `emit-${w.event}`,
    targetHandle: `listen-${w.event}`,
    type: 'eventFlow',
    data: {
      event: w.event,
      isCrossOrbital: false,
      fromTrait: w.emitterTrait,
      toTrait: w.listenerTrait,
    },
  }));

  return { nodes, edges };
}
