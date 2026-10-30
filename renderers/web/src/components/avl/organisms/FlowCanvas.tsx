'use client';

/**
 * FlowCanvas — V3 UI Projection Canvas
 *
 * The canvas IS the app. Nodes show rendered UI thumbnails from
 * render-ui effects. Edges show events connecting screens.
 *
 * Local view (default): one orbital card, Tab / Shift+Tab to move between
 * orbitals. World view: every orbital card. Each card picks the state it
 * shows from a dropdown in its header.
 */

import React, { useMemo, useState, useCallback, useEffect, Profiler } from 'react';
import {
  ReactFlowProvider,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useNodesInitialized,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type Connection,
} from '@xyflow/react';
import type { EditFocus, EventEmit, EventKey, OrbitalSchema, ThemeDefinition, EntityData } from '@almadar/core';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { HStack } from '../../../core';
import { Button } from '../../../core';
import { Icon } from '../../../core';
import { Select } from '../../../core';
import { ButtonGroup } from '../../core/molecules/ButtonGroup';
import { IconButton } from '../../core/molecules/IconButton';
import { useCompactLayout } from '../../core/organisms/layout/DockLayout';
import { ElementEditAccessContext, type ElementEditAccessResolver } from '../../../lib/element-edit-access';
import { OrbPreviewNode, ScreenSizeContext, PatternSelectionContext, CanvasToolsContext, CanvasStatePickerContext, CanvasVerifyContext, CanvasCardWidthContext, type CanvasStatePicker, type CanvasVerify, type SelectedPattern } from '../molecules/OrbPreviewNode';
import { CANVAS_TOOLS, type CanvasTool } from '../../../lib/canvas-tools';
import { TraitCardNode, TraitCardSelectionContext, type TraitCardTransitionClick } from '../molecules/TraitCardNode';
import { SystemNode, SystemBandNode, DependencyNode, DependencyColumnNode, SystemMapContext, useOpenTraits, type SystemMapContextValue } from '../molecules/SystemNode';
import { OrbPreview } from '../../../preview/OrbPreview';
import { dependencyReach, schemaToDependencyGraph, type SystemDependencies } from '../../../lib/avl-dependency-graph';
import { flowNeighbors, traitFlowCanvas, traitFlowGraph, type TraitFlowUnit } from '../../../lib/avl-trait-flow';
import { Input } from '../../../core';
import type { AvlPlayStep } from '../../../lib/avl-play';
import { EventFlowEdge } from '../molecules/EventFlowEdge';
import { canvasViewGraph, stateOptionsOf, initialStateOf, optionForPlayedStep, orbitalToTraitGraph, schemaToSystemGraph, LIVE_STATE, canvasViewChanged, type CanvasStateOptions, type CanvasViewport } from '../../../lib/avl-preview-converter';
import { OrbInspector } from './OrbInspector';
import { AvlGraphCanvas } from './AvlGraphCanvas';
import { validateWire } from '../../../lib/wire-validation';
import { useEventBus } from '../../../core';
import { useKeyMapEvents } from '../../../hooks/useKeyMapEvents';
import { isEditableTarget } from '../../../lib/keyMapEvent';
import { useTranslate } from '../../../core';
import { usePrefersReducedMotion } from '../../../core';
import { createLogger } from '@almadar/logger';
import { perfStart, perfEnd, profilerOnRender } from '../../../lib/perf';
import { type ViewLevel, type PreviewNodeData, type EventEdgeData, type ScreenSize, SCREEN_SIZE_PRESETS, detectScreenSize } from '../../../lib/avl-preview-converter';

// ---------------------------------------------------------------------------
// Node & edge type registries
// ---------------------------------------------------------------------------

const flowCanvasLog = createLogger('almadar:ui:flow-canvas');

const NODE_TYPES: NodeTypes = {
  preview: OrbPreviewNode,
  traitCard: TraitCardNode,
} as NodeTypes;

// AVL canvas wire check: if OrbPreviewNode resolves to
// `undefined` at module init (broken upstream import, circular dependency,
// stale bundle), ReactFlow falls back to the default node renderer and the
// canvas shows empty white strips instead of orbital previews. Log the
// registry shape so the regression is visible in the browser console.
flowCanvasLog.debug('node-type-registry', () => ({
  registered: Object.keys(NODE_TYPES),
  preview: typeof OrbPreviewNode,
  previewIsValid: typeof OrbPreviewNode === 'function' || (typeof OrbPreviewNode === 'object' && OrbPreviewNode !== null),
}));

const EDGE_TYPES: EdgeTypes = {
  eventFlow: EventFlowEdge,
} as EdgeTypes;

const DEFAULT_EDGE_OPTIONS = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type CanvasNode = Node<PreviewNodeData>;

const NO_SYSTEM_MAP: SystemMapContextValue = {};

/** The trait level's lens, and the unit whose traits the Traits lens is narrowed to. */
export interface TraitView {
  lens: 'flow' | 'traits';
  filter: { unit: string; traits: readonly string[] } | null;
}
const DEFAULT_TRAIT_VIEW: TraitView = { lens: 'flow', filter: null };

function isPreviewCard(n: CanvasNode): n is Node<PreviewNodeData> {
  return n.type === 'preview';
}

function withCardWidth(n: CanvasNode, width: number): CanvasNode {
  return isPreviewCard(n) ? { ...n, data: { ...n.data, cardWidth: width } } : n;
}

/** `local`: only the focused orbital's card; `world`: every orbital's card. */
export type CanvasScope = 'local' | 'world';

export interface CanvasFocusChange {
  orbital: string;
  scope: CanvasScope;
  /** The focused card's chosen state (`LIVE_STATE` for the live orbital). */
  state: string;
}

/** Where a card sits on the canvas, and its frame width when the designer resized it. */
export interface CanvasNodePlacement {
  x: number;
  y: number;
  width?: number;
}

export interface FlowCanvasProps {
  schema: OrbitalSchema | string;
  mockData?: EntityData;
  className?: string;
  width?: number | string;
  height?: number | string;
  onNodeClick?: (context: {
    // 'transition' is fired when a TraitCardNode transition row is
    // clicked at `trait-expanded` level. It's not a FlowCanvas view
    // level — consumers (cosmic) use it as a signal to drill into
    // their own transition-detail view.
    level: ViewLevel | 'code' | 'transition';
    orbital: string;
    trait?: string;
    transition?: string;
    /** With `level: 'transition'`: the clicked transition's index in the trait's state machine. */
    transitionIndex?: number;
  }) => void;
  /** With `initialLevel="system"`: what an orbital chip does (drill in, hover preview, open code, preview). */
  systemMap?: Omit<SystemMapContextValue, 'openTraitsEvent' | 'selectDependency'>;
  /** Emits UI:{openTraitsEvent} with { orbital } when an orbital on the system map is opened (drilled into). */
  openTraitsEvent?: EventEmit<{ orbital: string }>;
  /** With `initialLevel="system"`: the app's imports, for the Dependencies lens (absent: Events only). */
  systemDependencies?: SystemDependencies;
  /** Trait level: which lens (and trait filter) shows — pass with `onTraitViewChange` to keep it across remounts. */
  traitView?: TraitView;
  /** @notification */
  onTraitViewChange?: (view: TraitView) => void;
  /** The top bar (lenses, scope, screen size); an embedding host that drives the canvas itself can leave it out. */
  toolbar?: boolean;
  /** Refit whenever the frame resizes (a host column that grows on hover); off, a user's pan and zoom survive. */
  fitOnResize?: boolean;
  /** Flow lens: the unit the host lights (`null`: none); absent, the user's own clicks select. */
  flowSelection?: string | null;
  /**
   * Flow lens: the unit the user clicked.
   * @notification
   */
  onFlowSelect?: (unit: TraitFlowUnit) => void;
  /** Dependencies lens: emits UI:{openBehaviorEvent} with { name } to open a selected behavior's source. */
  openBehaviorEvent?: EventEmit<{ name: string }>;
  /** Maps a keydown `e.code` — optionally prefixed `Mod+` (⌘/Ctrl), `Shift+`, `Alt+` in that order — to an event, emitted as `UI:{event}`; keystrokes inside inputs/textareas never route. */
  keyMap?: Record<string, EventKey>;
  /** With `initialLevel="trait-expanded"`: played steps lighting each trait card's state machine. */
  scene?: { steps: readonly AvlPlayStep[]; cursor: number };
  /**
   * Fired when the focused orbital, the scope, or the focused card's state changes.
   * @notification
   */
  onFocusChange?: (focus: CanvasFocusChange) => void;
  /** The orbital cards open on (local view) — or, with `initialLevel="trait-expanded"`, the orbital whose traits are shown. */
  initialOrbital?: string;
  /** `trait-expanded`: one card per trait of `initialOrbital` (cosmic). Default: orbital cards. */
  initialLevel?: ViewLevel;
  /** Focus this orbital (e.g. picked in a Layers panel); changing it moves the focus without remounting. */
  focusedOrbital?: string;
  /** Pre-select a node on mount (opens OrbInspector). */
  initialSelectedNode?: PreviewNodeData;
  /** Enable editing in the inspector. When true, fields become inputs. */
  editable?: boolean;
  /** Called when the user edits the schema via the inspector. */
  onSchemaChange?: (schema: OrbitalSchema) => void;
  /** Called when the user presses Delete/Backspace with patterns selected (all of a multi-select). */
  onPatternDelete?: (context: { patternIds: string[]; nodeData: PreviewNodeData; elements?: EditFocus[] }) => void;
  /** Editing tools the canvas turns on (a persona's shell manifest declares them); all by default. */
  tools?: readonly CanvasTool[];
  /** What each element lets the user change (knob, data-bound, fixed by a behavior); every prop is editable without it. */
  elementAccess?: ElementEditAccessResolver;
  /** Called when the user drags from a source handle to a target handle (event wiring). */
  onEventWire?: (wire: { eventName: string; sourceOrbital: string; targetOrbital: string; sourceTraitName?: string; targetTraitName?: string }) => void;
  /** Behavior layer metadata for node styling (layer color bands). */
  behaviorMeta?: Record<string, { layer: string }>;
  /**
   * Per-orbital generation status. Keyed by orbital name. Drives the spinner
   * + accent border treatment on the overview node and (future) the hover
   * trace surface. Defaults to `'idle'` for missing entries. Consumers
   * derive this from agent subagent_start/complete SSE events.
   */
  orbitalStatus?: Record<string, PreviewNodeData['status']>;
  /**
   * Hover handler for overview-level orbital nodes. Fires with the orbital
   * name on enter and `null` on leave. Reserved for the upcoming trace
   * tooltip: consumers will use it to anchor a popover that shows the
   * subagent's live trace + reasoning for the hovered orbital.
   * @notification
   */
  onOrbitalHover?: (orbitalName: string | null) => void;
  /** Layout hint: 'pipeline' renders nodes left-to-right, 'grid' (default) uses sqrt-based grid. */
  layoutHint?: 'pipeline' | 'grid';
  /** Called when the user clicks a node in overview level (for composition hints). */
  onNodeSelect?: (orbitalName: string) => void;
  /**
   * @deprecated Use onNodeClick instead. Kept for AvlCosmicZoom compat.
   * @notification
   */
  onZoomChange?: (level: string, context: Record<string, string | undefined>) => void;
  /** @deprecated Not used in V3. */
  focusTarget?: { type: string; name: string };
  /** @deprecated Not used in V3. */
  color?: string;
  /** @deprecated Not used in V3. */
  animated?: boolean;
  /** @deprecated Not used in V3. */
  initialTrait?: string;
  /** @deprecated Not used in V3. */
  stateCoverage?: Record<string, string>;
  /**
   * Studio persona viewing the canvas. Drives `OrbInspector` tab/section
   * visibility — designers and builders hide the raw `code` tab and the
   * architect-only Entity / raw-guard / raw-effects sections; architects see
   * everything. Default `'builder'` preserves pre-Phase-2 behavior.
   */
  userType?: 'builder' | 'designer' | 'architect';
  /**
   * Project theme tokens (Design System tab only). Forwarded to `OrbInspector`
   * so the Styles tab can render an editable token list when the selection
   * originates from the synthesized `__design_system__` schema.
   */
  themeManifest?: ThemeDefinition;
  /**
   * Persisted node positions keyed by node id. When the node set changes
   * (level/schema switch), any id present here overrides the computed layout
   * position, restoring a user's manual drag arrangement. Node ids are unique
   * per view level, so a single flat map covers overview + expanded. A saved
   * `width` restores a card frame the designer resized.
   */
  nodePositions?: Record<string, CanvasNodePlacement>;
  /**
   * Fired on node drag-stop and card resize with the full {id → placement}
   * map of the current node set, so the consumer can persist the arrangement.
   * @notification
   */
  onPositionsChange?: (positions: Record<string, CanvasNodePlacement>) => void;
  /**
   * Fired whenever the internal `selectedNode` changes — select, clear-on-
   * escape, clear-on-level-change, and pattern-selection sync all route
   * through this. Lets a consumer mirror selection into a persistent
   * properties panel rendered outside the canvas (see `externalInspector`).
   * @notification
   */
  onSelectedNodeChange?: (node: PreviewNodeData | null) => void;
  /**
   * Fired whenever the in-node pattern selection changes (a pattern click
   * inside `OrbPreviewNode`, cleared on background click / Escape / pattern
   * delete). `PatternSelectionContext` is internal to this component's own
   * render tree, so an externally-rendered `OrbInspector` (see
   * `externalInspector`) has no other way to learn which pattern the user
   * picked — pass this straight through to `OrbInspector`'s `selectedPattern`
   * prop to keep Design-tab prop editing working outside the canvas.
   * @notification
   */
  onSelectedPatternChange?: (pattern: SelectedPattern | null) => void;
  /**
   * When true, FlowCanvas does not render its inline `OrbInspector` — the
   * consumer is expected to render one externally, fed by
   * `onSelectedNodeChange` + `onSelectedPatternChange`. Selection
   * highlighting, keyboard delete, and every other behavior is unchanged.
   * Default `false` preserves the built-in inline panel.
   */
  externalInspector?: boolean;
  /** A host that verifies from the canvas: cards show verify controls and the trait's verdict,
   *  and follow the states a run reaches (`verify.follow`). */
  verify?: CanvasVerify;
}

// ---------------------------------------------------------------------------
// Inner component (needs ReactFlowProvider)
// ---------------------------------------------------------------------------

function FlowCanvasInner({
  schema: schemaProp,
  mockData,
  className,
  width = '100%',
  height = 500,
  onNodeClick,
  onFocusChange,
  initialOrbital,
  initialLevel,
  focusedOrbital: focusedOrbitalProp,
  initialSelectedNode,
  editable,
  onSchemaChange,
  onPatternDelete,
  tools = CANVAS_TOOLS,
  elementAccess,
  onEventWire,
  behaviorMeta,
  orbitalStatus,
  layoutHint,
  onNodeSelect,
  userType = 'builder',
  verify,
  themeManifest,
  nodePositions,
  onPositionsChange,
  onSelectedNodeChange,
  onSelectedPatternChange,
  externalInspector = false,
  scene,
  systemMap,
  systemDependencies,
  openBehaviorEvent,
  openTraitsEvent,
  keyMap,
  traitView: traitViewProp,
  onTraitViewChange,
  flowSelection,
  onFlowSelect,
  toolbar = true,
  fitOnResize = false,
}: FlowCanvasProps) {
  const { t } = useTranslate();
  // Render-time NODE_TYPES / EDGE_TYPES — not module-level. When vite's
  // dep-optimizer splits @almadar/ui/avl across multiple pre-bundle
  // chunks (apps/builder triggers this), FlowCanvas and OrbPreviewNode
  // can land in different chunks. A module-level
  // `const NODE_TYPES = { preview: OrbPreviewNode }` then runs while the
  // cross-chunk `OrbPreviewNode` binding is still `undefined`, ReactFlow
  // falls back to the default node type, and the canvas renders empty
  // white strips (apps/builder regression, observed 2026-05-11 via
  // `[almadar:ui:flow-canvas] node-type-registry preview: 'undefined'`).
  // useMemo at render time captures the fully-resolved import.
  const NODE_TYPES = useMemo<NodeTypes>(() => ({
    preview: OrbPreviewNode,
    traitCard: TraitCardNode,
    system: SystemNode,
    systemBand: SystemBandNode,
    dependency: DependencyNode,
    dependencyColumn: DependencyColumnNode,
  } as NodeTypes), []);
  const EDGE_TYPES_LOCAL = useMemo<EdgeTypes>(() => ({
    eventFlow: EventFlowEdge,
  } as EdgeTypes), []);

  flowCanvasLog.debug('node-type-registry:render', () => ({
    registered: Object.keys(NODE_TYPES),
    preview: typeof OrbPreviewNode,
    previewIsValid: typeof OrbPreviewNode === 'function' || (typeof OrbPreviewNode === 'object' && OrbPreviewNode !== null),
  }));

  const parsedSchema = useMemo<OrbitalSchema>(() => {
    if (typeof schemaProp === 'string') return JSON.parse(schemaProp) as OrbitalSchema;
    return schemaProp;
  }, [schemaProp]);

  const traitLevel = initialLevel === 'trait-expanded';
  const systemLevel = initialLevel === 'system';
  const [systemQuery, setSystemQuery] = useState('');
  const [wiresOnly, setWiresOnly] = useState(false);
  const [lens, setLens] = useState<'events' | 'dependencies'>('events');
  const [dependencySelection, setDependencySelection] = useState<string | null>(null);
  const dependencyLens = systemLevel && lens === 'dependencies' && systemDependencies !== undefined;
  // Trait level: Flow (the orbital as the units its traits come from) or Traits (every trait's state machine).
  const [ownTraitView, setOwnTraitView] = useState<TraitView>(DEFAULT_TRAIT_VIEW);
  const traitView = traitViewProp ?? ownTraitView;
  const setTraitView = useCallback((next: TraitView) => {
    setOwnTraitView(next);
    onTraitViewChange?.(next);
  }, [onTraitViewChange]);
  const traitLens = traitView.lens;
  const traitFilter = useMemo(() => (traitView.filter ? { unit: traitView.filter.unit, traits: new Set(traitView.filter.traits) } : null), [traitView.filter]);
  const flowLens = traitLevel && traitLens === 'flow';
  // The system map and the flow frame many small pills; the other levels frame one or a few large cards.
  const fitPadding = systemLevel || flowLens ? 0.08 : 0.25;
  const compact = useCompactLayout();
  const [scope, setScope] = useState<CanvasScope>('local');
  const scopeRef = React.useRef(scope);
  scopeRef.current = scope;
  const [focusRequest, setFocusRequest] = useState<string | undefined>(focusedOrbitalProp ?? initialOrbital);
  const [stateByOrbital, setStateByOrbital] = useState<Record<string, string>>({});
  // A focus change in world view centres on the focused card instead of re-fitting every card.
  const fitFocusedRef = React.useRef(false);
  const pendingFitRef = React.useRef<{ centreOn: string | undefined } | null>(null);
  const fittedViewRef = React.useRef<CanvasViewport | null>(null);
  useEffect(() => {
    if (focusedOrbitalProp === undefined) return;
    fitFocusedRef.current = true;
    setFocusRequest(focusedOrbitalProp);
  }, [focusedOrbitalProp]);

  // Screen size driving OrbPreviewNode width. Default is auto-detected from
  // the user's viewport on mount (SSR-safe fallback to 'laptop'), and tracks
  // window resize until the user manually picks a preset — after which their
  // choice is sticky for the session. Matches the responsiveness-audit tiers.
  const screenSizeUserOverrideRef = React.useRef(false);
  const [screenSize, setScreenSize] = useState<ScreenSize>(() =>
    typeof window === 'undefined' ? 'laptop' : detectScreenSize(window.innerWidth),
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => {
      if (screenSizeUserOverrideRef.current) return;
      setScreenSize(detectScreenSize(window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const pickScreenSize = useCallback((size: ScreenSize) => {
    screenSizeUserOverrideRef.current = true;
    setScreenSize(size);
  }, []);
  const [selectedNode, setSelectedNodeInternal] = useState<PreviewNodeData | null>(initialSelectedNode ?? null);
  // Single choke point for every selection change so `onSelectedNodeChange`
  // never misses a call site (select, clear-on-escape, pattern-selection sync).
  const setSelectedNode = useCallback((node: PreviewNodeData | null) => {
    setSelectedNodeInternal(node);
    onSelectedNodeChange?.(node);
  }, [onSelectedNodeChange]);
  const [selectedPattern, setSelectedPatternInternal] = useState<SelectedPattern | null>(null);
  // Single choke point for every pattern-selection change, mirroring
  // `setSelectedNode` above — keeps `onSelectedPatternChange` in sync with
  // every call site (select, clear-on-background-click, delete) instead of
  // only the ones that happen to go through `patternSelectionValue.select`.
  const setSelectedPattern = useCallback((p: SelectedPattern | null) => {
    setSelectedPatternInternal(p);
    onSelectedPatternChange?.(p);
  }, [onSelectedPatternChange]);

  const patternSelectionValue = useMemo(() => ({
    selected: selectedPattern,
    select: (p: SelectedPattern | null) => {
      setSelectedPattern(p);
      // When a pattern is selected, also set the node for OrbInspector
      if (p) setSelectedNode(p.nodeData);
    },
  }), [selectedPattern, setSelectedNode, setSelectedPattern]);

  // Designers see one state per distinct screen; everyone else one per transition.
  const stateView = userType === 'designer' ? 'screens' : 'transitions';

  const { canvas, traitExpandedNodes, traitExpandedEdges } = useMemo(() => {
    const t = perfStart('canvas-graph');
    const view = canvasViewGraph(parsedSchema, {
      scope,
      focusedOrbital: focusRequest,
      stateByOrbital,
      view: stateView,
      mockData,
      behaviorMeta,
      layoutHint,
      orbitalStatus,
      screenSize,
    });
    // COSMIC-1: one card per trait of `initialOrbital` with intra-orbital `emit→listen` edges.
    const traitExpanded = traitLevel && initialOrbital
      ? orbitalToTraitGraph(parsedSchema, initialOrbital, mockData)
      : { nodes: [], edges: [] };
    perfEnd('canvas-graph', t, {
      canvasNodes: view.nodes.length,
      traitExpandedNodes: traitExpanded.nodes.length,
      orbitalCount: parsedSchema.orbitals?.length ?? 0,
    });
    return {
      canvas: view,
      traitExpandedNodes: traitExpanded.nodes,
      traitExpandedEdges: traitExpanded.edges,
    };
  }, [parsedSchema, scope, focusRequest, stateByOrbital, stateView, traitLevel, initialOrbital, behaviorMeta, layoutHint, mockData, orbitalStatus, screenSize]);

  const focusedOrbital = canvas.focusedOrbital;
  const orbitalNames = useMemo(() => (parsedSchema.orbitals ?? []).map((o) => o.name), [parsedSchema]);

  const systemGraph = useMemo(() => (systemLevel ? schemaToSystemGraph(parsedSchema) : null), [systemLevel, parsedSchema]);
  const systemNodes = useMemo<CanvasNode[]>(() => {
    if (!systemGraph) return [];
    const q = systemQuery.trim().toLowerCase();
    const matches = (d: PreviewNodeData): boolean =>
      [d.orbitalName, d.entityName ?? '', ...(d.wireEvents ?? [])].some((text) => text.toLowerCase().includes(q));
    return systemGraph.nodes
      .filter((n) => !wiresOnly || n.data.bandKind === 'connected' || (n.data.kind === 'system-orbital' && (n.data.wireEvents?.length ?? 0) > 0))
      .map((n) => (q && n.data.kind === 'system-orbital' && !matches(n.data) ? { ...n, style: { opacity: 0.25 } } : n));
  }, [systemGraph, systemQuery, wiresOnly]);
  const dependencyGraph = useMemo(() => (dependencyLens && systemDependencies ? schemaToDependencyGraph(systemDependencies) : null), [dependencyLens, systemDependencies]);
  const reach = useMemo(
    () => (dependencySelection && systemDependencies ? dependencyReach(systemDependencies, dependencySelection) : null),
    [dependencySelection, systemDependencies],
  );
  const dependencyNodes = useMemo<CanvasNode[]>(() => {
    if (!dependencyGraph) return [];
    const q = systemQuery.trim().toLowerCase();
    return dependencyGraph.nodes.map((n) => {
      if (n.data.kind !== 'dependency') return n;
      const role: PreviewNodeData['dependencyRole'] = !reach
        ? q && !n.data.orbitalName.toLowerCase().includes(q) ? 'dim' : undefined
        : n.id === dependencySelection ? 'selected' : reach.upstream.has(n.id) ? 'upstream' : reach.downstream.has(n.id) ? 'downstream' : 'dim';
      return role ? { ...n, data: { ...n.data, dependencyRole: role } } : n;
    });
  }, [dependencyGraph, reach, dependencySelection, systemQuery]);
  const dependencyEdges = useMemo<Edge<EventEdgeData>[]>(() => {
    if (!dependencyGraph) return [];
    const inUp = (id: string) => id === dependencySelection || (reach?.upstream.has(id) ?? false);
    const inDown = (id: string) => id === dependencySelection || (reach?.downstream.has(id) ?? false);
    return dependencyGraph.edges.map((e) => {
      const up = reach !== null && inUp(e.source) && reach.upstream.has(e.target);
      const down = reach !== null && inDown(e.target) && reach.downstream.has(e.source);
      const stroke = up ? 'var(--color-primary)' : down ? 'var(--color-warning)' : 'var(--color-border)';
      return {
        ...e,
        type: 'default',
        markerEnd: undefined,
        selectable: false,
        style: { stroke, strokeWidth: up || down ? 1.6 : 1, opacity: up || down ? 0.95 : reach ? 0.12 : 0.35 },
        data: { event: '' },
      };
    });
  }, [dependencyGraph, reach, dependencySelection]);
  const flow = useMemo(() => {
    if (!traitLevel || !initialOrbital) return null;
    const layers = Object.fromEntries(Object.entries(systemDependencies?.behaviors ?? {}).map(([name, b]) => [name, b.layer]));
    return traitFlowGraph(parsedSchema, initialOrbital, layers);
  }, [traitLevel, initialOrbital, parsedSchema, systemDependencies]);
  const flowSelected = flowSelection !== undefined ? flowSelection : dependencySelection;
  const flowCanvas = useMemo(() => (flow ? traitFlowCanvas(flow) : null), [flow]);
  const flowReach = useMemo(() => (flow && flowSelected && flowLens ? flowNeighbors(flow.edges, flowSelected) : null), [flow, flowSelected, flowLens]);
  const flowNodes = useMemo<CanvasNode[]>(() => {
    if (!flowCanvas) return [];
    return flowCanvas.nodes.map((n) => {
      if (n.data.kind !== 'dependency' || !flowReach) return n;
      const role: PreviewNodeData['dependencyRole'] =
        n.id === flowSelected ? 'selected'
          : flowReach.triggeredBy.has(n.id) && flowReach.triggers.has(n.id) ? 'both'
            : flowReach.triggeredBy.has(n.id) ? 'upstream' : flowReach.triggers.has(n.id) ? 'downstream' : 'dim';
      return { ...n, data: { ...n.data, dependencyRole: role } };
    });
  }, [flowCanvas, flowReach, flowSelected]);
  const flowEdges = useMemo<Edge<EventEdgeData>[]>(() => {
    if (!flow) return [];
    return flow.edges.map((e) => {
      const into = flowSelected !== null && e.target === flowSelected;
      const out = flowSelected !== null && e.source === flowSelected;
      const stroke = into ? 'var(--color-primary)' : out ? 'var(--color-warning)' : 'var(--color-border)';
      const drawn = flowCanvas?.edges.find((c) => c.id === `flow-${e.source}-${e.target}`);
      return {
        id: `flow-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        ...(drawn?.sourceHandle ? { sourceHandle: drawn.sourceHandle } : {}),
        ...(drawn?.targetHandle ? { targetHandle: drawn.targetHandle } : {}),
        type: 'default',
        selectable: false,
        style: { stroke, strokeWidth: into || out ? 1.8 : 1, opacity: into || out ? 0.95 : flowSelected ? 0.14 : 0.4 },
        ...(into || out
          ? {
              label: e.events.join(', '),
              labelStyle: { fill: stroke, fontSize: 10, fontFamily: 'var(--font-mono, monospace)' },
              labelBgStyle: { fill: 'var(--color-background)', stroke, strokeWidth: 0.8 },
              labelBgPadding: [6, 3] as [number, number],
              labelBgBorderRadius: 8,
            }
          : {}),
        data: { event: '' },
      };
    });
  }, [flow, flowCanvas, flowSelected]);
  const selectedUnit = flowLens && flow ? flow.units.find((u) => u.id === flowSelected) : undefined;
  const systemWireCount = systemGraph?.edges.length ?? 0;
  const systemOrbitalCount = systemGraph?.nodes.filter((n) => n.data.kind === 'system-orbital').length ?? 0;

  const filteredTraitNodes = useMemo(
    () => (traitFilter ? traitExpandedNodes.filter((n) => traitFilter.traits.has(n.data.traitName ?? '')) : traitExpandedNodes),
    [traitExpandedNodes, traitFilter],
  );
  const activeNodes: CanvasNode[] = dependencyLens ? dependencyNodes : systemLevel ? systemNodes : flowLens ? flowNodes : traitLevel ? filteredTraitNodes : canvas.nodes;
  const activeEdges: Edge<EventEdgeData>[] = dependencyLens ? dependencyEdges : systemGraph ? systemGraph.edges : flowLens ? flowEdges : traitLevel ? traitExpandedEdges : canvas.edges;

  const [nodes, setNodes, onNodesChange] = useNodesState(activeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(activeEdges);

  const reactFlow = useReactFlow();
  const cameraMs = usePrefersReducedMotion() ? 0 : 300;

  // Persisted-position overlay. Held in a ref and read only when the node SET
  // changes, so a consumer updating its store mid-drag never clobbers the
  // live xyflow positions.
  const savedPositionsRef = React.useRef(nodePositions);
  savedPositionsRef.current = nodePositions;
  // Latest nodes via ref so onNodeDragStop reads post-drag positions without
  // rebuilding its closure every drag frame.
  const nodesRef = React.useRef(nodes);
  nodesRef.current = nodes;

  // Sync nodes/edges when the view or schema changes. setNodes/setEdges write
  // to separate zustand stores; between them xyflow can briefly see new
  // nodes paired with old edges (or vice versa). Clear edges FIRST so no
  // edge ever references a node id that's about to disappear, then set the
  // new nodes (overlaid with any saved positions), then the new edges.
  useEffect(() => {
    setEdges([]);
    const saved = savedPositionsRef.current;
    // A saved position places a card in the world view; the local view's one
    // card sits at the origin. A resized width applies in both.
    const merged = saved
      ? activeNodes.map((n) => {
          const placement = saved[n.id];
          if (!placement) return n;
          const placed = scope === 'world' ? { ...n, position: { x: placement.x, y: placement.y } } : n;
          return placement.width !== undefined ? withCardWidth(placed, placement.width) : placed;
        })
      : activeNodes;
    setNodes(merged);
    setEdges(activeEdges);
    // Fit once the new cards are measured (fitting before that leaves the card
    // off-centre) — but only when the view changed. A workspace update keeps
    // the user's zoom and pan.
    const viewport: CanvasViewport = { scope, focusedOrbital, screenSize, ...(systemLevel ? { level: dependencyLens ? 'system-dependencies' : wiresOnly ? 'system-wires' : 'system' } : traitLevel ? { level: flowLens ? 'trait-flow' : traitFilter ? `trait-cards:${traitFilter.unit}` : 'trait-cards' } : {}) };
    if (canvasViewChanged(fittedViewRef.current, viewport)) {
      pendingFitRef.current = { centreOn: fitFocusedRef.current && scope === 'world' ? focusedOrbital : undefined };
      fittedViewRef.current = viewport;
    }
    fitFocusedRef.current = false;
  }, [activeNodes, activeEdges, setNodes, setEdges, scope, focusedOrbital, screenSize, systemLevel, wiresOnly, dependencyLens, traitLevel, flowLens, traitFilter]);

  const frameRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!fitOnResize || !frame) return;
    let queued = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(queued);
      queued = requestAnimationFrame(() => void reactFlow.fitView({ padding: fitPadding }));
    });
    observer.observe(frame);
    return () => {
      cancelAnimationFrame(queued);
      observer.disconnect();
    };
  }, [fitOnResize, reactFlow, fitPadding]);

  const nodesInitialized = useNodesInitialized();
  useEffect(() => {
    const pending = pendingFitRef.current;
    if (!nodesInitialized || !pending) return;
    pendingFitRef.current = null;
    void reactFlow.fitView({ duration: cameraMs, padding: fitPadding, ...(pending.centreOn ? { nodes: [{ id: pending.centreOn }] } : {}) });
  }, [nodesInitialized, nodes, reactFlow, fitPadding, cameraMs]);


  // Defense in depth: never render an edge whose source/target isn't in the
  // current node set.
  const visibleEdges = useMemo(() => {
    const nodeIds = new Set(nodes.map(n => n.id));
    return edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }, [nodes, edges]);

  const focusOrbital = useCallback((orbital: string) => {
    fitFocusedRef.current = true;
    setFocusRequest(orbital);
  }, []);

  const stepFocus = useCallback((step: 1 | -1) => {
    if (orbitalNames.length === 0) return;
    const at = focusedOrbital ? orbitalNames.indexOf(focusedOrbital) : -1;
    focusOrbital(orbitalNames[(at + step + orbitalNames.length) % orbitalNames.length]);
  }, [orbitalNames, focusedOrbital, focusOrbital]);

  const stateOptionsCache = useMemo(() => new Map<string, CanvasStateOptions>(), [parsedSchema, stateView, mockData]);
  const optionsOf = useCallback((orbital: string): CanvasStateOptions => {
    const cached = stateOptionsCache.get(orbital);
    if (cached) return cached;
    const options = stateOptionsOf(parsedSchema, orbital, stateView, mockData);
    stateOptionsCache.set(orbital, options);
    return options;
  }, [stateOptionsCache, parsedSchema, stateView, mockData]);
  // The picked state while it still exists, else the card's INIT state (as `canvasViewGraph` resolves it).
  const chosenStateOf = useCallback((orbital: string): string => {
    const asked = stateByOrbital[orbital];
    const options = optionsOf(orbital);
    const exists = asked === LIVE_STATE || [...options.own, ...options.groups.flatMap((g) => g.options)].some((o) => o.id === asked);
    return exists && asked !== undefined ? asked : initialStateOf(options);
  }, [stateByOrbital, optionsOf]);

  useEffect(() => {
    if (!focusedOrbital || traitLevel || systemLevel) return;
    onFocusChange?.({ orbital: focusedOrbital, scope, state: chosenStateOf(focusedOrbital) });
  }, [focusedOrbital, scope, chosenStateOf, traitLevel, systemLevel, onFocusChange]);

  const statePicker = useMemo<CanvasStatePicker>(() => ({
    optionsOf,
    chosen: chosenStateOf,
    choose: (orbital, stateId) => {
      setSelectedPattern(null);
      setSelectedNode(null);
      setStateByOrbital((prev) => ({ ...prev, [orbital]: stateId }));
    },
  }), [optionsOf, chosenStateOf, setSelectedPattern, setSelectedNode]);

  // A card showing a picked state selects it (the inspector follows); a card
  // showing the live orbital only reports the orbital. In world view a click
  // also focuses that orbital.
  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    // COSMIC-1: at `trait-expanded` the meaningful interaction is the
    // transition-arc click inside the trait card (TraitCardSelectionContext).
    if (traitLevel || systemLevel) return;
    const nodeData = node.data as PreviewNodeData;
    const orbitalName = nodeData.orbitalName ?? node.id;
    if (scope === 'world' && orbitalName !== focusedOrbital) setFocusRequest(orbitalName);
    if (nodeData.traitName) {
      setSelectedNode(nodeData);
      onNodeClick?.({
        level: 'code',
        orbital: orbitalName,
        trait: nodeData.traitName,
        transition: nodeData.transitionEvent,
      });
      return;
    }
    onNodeClick?.({ level: 'overview', orbital: orbitalName });
    onNodeSelect?.(orbitalName);
  }, [traitLevel, systemLevel, scope, focusedOrbital, onNodeClick, onNodeSelect, setSelectedNode]);

  // Close transition panel
  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  // Escape closes the panel; Delete/Backspace deletes the selected pattern.
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (selectedNode) setSelectedNode(null);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      // Don't intercept when user is typing in an input
      if (isEditableTarget(e.target)) return;
      if (selectedPattern && selectedPattern.nodeData) {
        const patternIds = selectedPattern.selection ?? (selectedPattern.patternId ? [selectedPattern.patternId] : []);
        if (patternIds.length > 0) {
          onPatternDelete?.({ patternIds, nodeData: selectedPattern.nodeData, ...(selectedPattern.elements ? { elements: selectedPattern.elements } : {}) });
        }
        setSelectedPattern(null);
      }
    }
  }, [selectedNode, selectedPattern, onPatternDelete, setSelectedNode, setSelectedPattern]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Tab / Shift+Tab move between orbitals while the canvas has focus; Escape
  // with nothing selected hands focus back to the page.
  const handleCanvasKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (traitLevel || systemLevel || isEditableTarget(e.target)) return;
    if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey && orbitalNames.length > 1) {
      e.preventDefault();
      stepFocus(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape' && !selectedNode && !selectedPattern) {
      e.currentTarget.blur();
    }
  }, [traitLevel, systemLevel, orbitalNames.length, stepFocus, selectedNode, selectedPattern]);

  const eventBus = useEventBus();

  // Event wire drag: onConnect fires when user drags handle to handle
  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.sourceHandle?.startsWith('event-') || !onEventWire) return;
    const eventName = connection.sourceHandle.replace('event-', '');
    const sourceNode = nodes.find(n => n.id === connection.source);
    const targetNode = nodes.find(n => n.id === connection.target);
    if (!sourceNode || !targetNode) return;

    const srcData = sourceNode.data as PreviewNodeData;
    const tgtData = targetNode.data as PreviewNodeData;

    // Wire validation: check payload compatibility
    const sourceEventSource = srcData.eventSources?.find(es => es.event === eventName);
    const sourcePayload = sourceEventSource?.payloadFields;
    // Look for a matching event on the target side for payload expectations
    const targetEventSource = tgtData.eventSources?.find(es => es.event === eventName);
    const targetPayload = targetEventSource?.payloadFields;
    const validation = validateWire(sourcePayload, targetPayload);
    if (validation.warnings.length > 0) {
      eventBus.emit('UI:WIRE_VALIDATION_WARNING', {
        eventName,
        sourceOrbital: srcData.orbitalName,
        targetOrbital: tgtData.orbitalName,
        warnings: validation.warnings,
      });
    }

    onEventWire({
      eventName,
      sourceOrbital: srcData.orbitalName ?? '',
      targetOrbital: tgtData.orbitalName ?? '',
      sourceTraitName: srcData.traitName,
      targetTraitName: tgtData.traitName,
    });
  }, [nodes, onEventWire, eventBus]);

  // Persist the arrangement: the current cards' placements merged over the
  // saved ones, so a local view (one card) never erases the others. A card in
  // the local view keeps its world position (its drawn origin isn't one).
  const worldPositionsRef = React.useRef(canvas.worldPositions);
  worldPositionsRef.current = canvas.worldPositions;
  const placementsOf = useCallback((list: readonly CanvasNode[]): Record<string, CanvasNodePlacement> => {
    const positions: Record<string, CanvasNodePlacement> = { ...savedPositionsRef.current };
    for (const n of list) {
      const width = isPreviewCard(n) ? n.data.cardWidth : undefined;
      const at = scopeRef.current === 'world' ? n.position : (savedPositionsRef.current?.[n.id] ?? worldPositionsRef.current[n.id] ?? n.position);
      positions[n.id] = { x: at.x, y: at.y, ...(typeof width === 'number' ? { width } : {}) };
    }
    return positions;
  }, []);

  const handleNodeDragStop = useCallback(() => {
    onPositionsChange?.(placementsOf(nodesRef.current));
  }, [onPositionsChange, placementsOf]);

  // A verification run reached a state: show it on the card, when the card has a screen for it.
  useEffect(() => verify?.follow(({ orbital, trait, event, from, to }) => {
    const option = optionForPlayedStep(optionsOf(orbital), { trait, event, from, to });
    if (option) statePicker.choose(orbital, option);
  }), [verify, optionsOf, statePicker]);

  // A card's frame was resized (OrbPreviewNode's right-edge control).
  const handleCardWidth = useCallback((nodeId: string, width: number) => {
    if (!nodesRef.current.some((n) => n.id === nodeId)) return;
    const next = nodesRef.current.map((n) => (n.id === nodeId ? withCardWidth(n, width) : n));
    setNodes(next);
    onPositionsChange?.(placementsOf(next));
  }, [setNodes, onPositionsChange, placementsOf]);

  const screenSizeKeys: ScreenSize[] = ['mobile', 'tablet', 'laptop', 'wide'];
  const isScreenSize = (value: string): value is ScreenSize => screenSizeKeys.some((k) => k === value);
  const applyScreenSize = (size: ScreenSize) => {
    pickScreenSize(size);
    requestAnimationFrame(() => {
      reactFlow.fitView({ duration: cameraMs, padding: 0.25 });
    });
  };

  // COSMIC-1: TraitCardNode (used at `trait-expanded`) bubbles row clicks
  // through this context. Translate them into the existing `onNodeClick`
  // surface with `level: 'transition'` so consumers (cosmic) can drill
  // into the transition detail scene without learning a new callback.
  const traitCardSelectionValue = useMemo(() => ({
    selectTransition: (sel: TraitCardTransitionClick) => {
      onNodeClick?.({
        level: 'transition',
        orbital: sel.orbitalName,
        trait: sel.traitName,
        transition: sel.transitionEvent,
        transitionIndex: sel.index,
      });
    },
    scene,
  }), [onNodeClick, scene]);

  const showOrbitalNav = !traitLevel && !systemLevel && orbitalNames.length > 0;
  const systemMapValue = useMemo<SystemMapContextValue>(() => {
    const map = systemMap ?? NO_SYSTEM_MAP;
    const livePreview = map.preview === true && map.renderPreview === undefined
      ? (orbital: string): React.ReactNode => {
          const found = parsedSchema.orbitals.find((o) => o.name === orbital);
          if (!found) return null;
          return (
            <Box data-testid="avl-system-preview-screen" className="w-80 h-48 overflow-hidden rounded-container border border-border">
              <OrbPreview schema={{ ...parsedSchema, orbitals: [found] }} isolated height="100%" fit />
            </Box>
          );
        }
      : undefined;
    return {
      ...map,
      ...(livePreview ? { renderPreview: livePreview } : {}),
      ...(openTraitsEvent ? { openTraitsEvent } : {}),
      selectDependency: (id: string) => {
        const clicked = flowLens ? flow?.units.find((u) => u.id === id) : undefined;
        if (clicked) onFlowSelect?.(clicked);
        setDependencySelection((current) => (current === id ? null : id));
      },
    };
  }, [systemMap, parsedSchema, openTraitsEvent, flowLens, flow, onFlowSelect]);
  const openTraits = useOpenTraits(systemMapValue);
  useKeyMapEvents(keyMap, undefined);
  const selectedDependency = dependencyGraph?.nodes.find((n) => n.id === dependencySelection)?.data;
  const selectedOrbital = selectedDependency?.dependencyColumn === 'app' ? selectedDependency.orbitalName : null;
  const selectedBehavior = selectedDependency && selectedDependency.dependencyColumn !== 'app' ? selectedDependency.orbitalName : null;

  return (
    <ScreenSizeContext.Provider value={screenSize}>
    <CanvasToolsContext.Provider value={tools}>
    <CanvasStatePickerContext.Provider value={traitLevel || systemLevel ? null : statePicker}>
    <CanvasVerifyContext.Provider value={verify ?? null}>
    <CanvasCardWidthContext.Provider value={handleCardWidth}>
    <SystemMapContext.Provider value={systemMapValue}>
    <ElementEditAccessContext.Provider value={elementAccess ?? null}>
    <PatternSelectionContext.Provider value={patternSelectionValue}>
    <TraitCardSelectionContext.Provider value={traitCardSelectionValue}>
      <Box
        ref={frameRef}
        className={`flex flex-col h-full ${className ?? ''}`}
        style={{ width, height }}
        data-testid="flow-canvas-frame"
      >
        {/* Top bar: orbital focus + scope, screen size — above the canvas, never over its cards */}
        {toolbar && (<Box
          className="flex-shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/40 bg-background"
          data-testid="flow-canvas-toolbar"
        >
          {systemLevel ? (
            <>
              <ButtonGroup variant="segmented">
                {(['events', 'dependencies'] as const).map((l) => (
                  <Button
                    key={l}
                    variant={lens === l ? 'primary' : 'ghost'}
                    size="sm"
                    aria-pressed={lens === l}
                    disabled={l === 'dependencies' && systemDependencies === undefined}
                    data-testid={`system-map-lens-${l}`}
                    onClick={() => setLens(l)}
                  >
                    {t(l === 'events' ? 'avl.system.lensEvents' : 'avl.system.lensDependencies')}
                  </Button>
                ))}
              </ButtonGroup>
              <Box className="w-64 max-w-full">
                <Input
                  leftIcon="search"
                  value={systemQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setSystemQuery(e.target.value)}
                  placeholder={t(dependencyLens ? 'avl.deps.search' : 'avl.system.search')}
                  aria-label={t(dependencyLens ? 'avl.deps.search' : 'avl.system.search')}
                  data-testid="system-map-search"
                  className="h-10 sm:h-7 py-0 text-sm"
                />
              </Box>
              {dependencyLens ? (
                <>
                  <Box className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card/80 border border-border/40 min-w-0" data-testid="dependency-summary">
                    <Typography variant="small" className="truncate">
                      {selectedDependency
                        ? t('avl.deps.selected', { name: selectedDependency.orbitalName, upstream: reach?.upstream.size ?? 0, downstream: reach?.downstream.size ?? 0 })
                        : t('avl.deps.hint')}
                    </Typography>
                  </Box>
                  {selectedOrbital && systemMap ? (
                    <Button variant="secondary" size="sm" rightIcon="chevron-right" onClick={() => openTraits(selectedOrbital)} data-testid="dependency-open-traits">
                      {t('avl.system.openTraits')}
                    </Button>
                  ) : null}
                  {selectedOrbital && systemMap?.openCodeEvent ? (
                    <Button variant="secondary" size="sm" leftIcon="code" action={systemMap.openCodeEvent} actionPayload={{ orbital: selectedOrbital }}>
                      {t('avl.system.openCode')}
                    </Button>
                  ) : null}
                  {selectedBehavior && openBehaviorEvent ? (
                    <Button variant="secondary" size="sm" leftIcon="code" action={openBehaviorEvent} actionPayload={{ name: selectedBehavior }}>
                      {t('avl.system.openCode')}
                    </Button>
                  ) : null}
                  <HStack gap="sm" align="center" className="ml-auto" data-testid="dependency-legend">
                    <Box className="w-2.5 h-2.5 rounded-sm bg-primary" />
                    <Typography variant="caption" color="muted">{t('avl.deps.legendUpstream')}</Typography>
                    <Box className="w-2.5 h-2.5 rounded-sm bg-warning" />
                    <Typography variant="caption" color="muted">{t('avl.deps.legendDownstream')}</Typography>
                  </HStack>
                </>
              ) : null}
              {!dependencyLens ? (<>
              <Box className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card/80 border border-border/40" data-testid="system-map-summary">
                <Typography variant="small" className="text-muted-foreground">
                  {t('avl.system.summary', { orbitals: systemOrbitalCount, wires: systemWireCount })}
                </Typography>
              </Box>
              <Button
                variant={wiresOnly ? 'primary' : 'ghost'}
                size="sm"
                aria-pressed={wiresOnly}
                disabled={systemWireCount === 0}
                data-testid="system-map-wires-only"
                onClick={() => setWiresOnly((w) => !w)}
              >
                {t('avl.system.wiresOnly')}
              </Button>
              </>) : null}
            </>
          ) : showOrbitalNav ? (
            <>
              <Box data-testid="canvas-orbital-nav" className="flex flex-nowrap items-center gap-1 min-w-0">
              <IconButton
                icon="chevron-left"
                label={t('canvas.previousOrbital')}
                tooltipPosition="bottom"
                className="w-10 h-10 sm:w-7 sm:h-7"
                data-testid="canvas-orbital-prev"
                disabled={orbitalNames.length < 2}
                onClick={() => stepFocus(-1)}
              />
              <Select
                options={orbitalNames.map((name) => ({ value: name, label: name }))}
                value={focusedOrbital ?? ''}
                onValueChange={(value) => { if (typeof value === 'string') focusOrbital(value); }}
                aria-label={t('canvas.focusedOrbital')}
                data-testid="canvas-orbital-picker"
                className="h-10 sm:h-7 py-0 text-sm min-w-0 max-w-[12rem]"
              />
              <IconButton
                icon="chevron-right"
                label={t('canvas.nextOrbital')}
                tooltipPosition="bottom"
                className="w-10 h-10 sm:w-7 sm:h-7"
                data-testid="canvas-orbital-next"
                disabled={orbitalNames.length < 2}
                onClick={() => stepFocus(1)}
              />
              </Box>
              <ButtonGroup variant="segmented">
                {(['local', 'world'] as const).map((s) => (
                  <Button
                    key={s}
                    variant={scope === s ? 'primary' : 'ghost'}
                    size="sm"
                    className="h-10 sm:h-button-sm"
                    aria-pressed={scope === s}
                    data-testid={`canvas-scope-${s}`}
                    title={t(s === 'local' ? 'canvas.scopeLocalHint' : 'canvas.scopeWorldHint')}
                    onClick={() => setScope(s)}
                  >
                    {t(s === 'local' ? 'canvas.scopeLocal' : 'canvas.scopeWorld')}
                  </Button>
                ))}
              </ButtonGroup>
            </>
          ) : traitLevel ? (
            <>
              <ButtonGroup variant="segmented">
                {(['flow', 'traits'] as const).map((l) => (
                  <Button
                    key={l}
                    variant={traitLens === l ? 'primary' : 'ghost'}
                    size="sm"
                    aria-pressed={traitLens === l}
                    data-testid={`trait-lens-${l}`}
                    onClick={() => setTraitView({ lens: l, filter: l === 'flow' ? null : traitView.filter })}
                  >
                    {t(l === 'flow' ? 'avl.flow.lensFlow' : 'avl.flow.lensTraits')}
                  </Button>
                ))}
              </ButtonGroup>
              {flowLens && flow ? (
                <>
                  <Box className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card/80 border border-border/40 min-w-0" data-testid="flow-summary">
                    <Typography variant="small" className="truncate">
                      {selectedUnit
                        ? t('avl.flow.selected', { name: selectedUnit.name, into: flowReach?.triggeredBy.size ?? 0, out: flowReach?.triggers.size ?? 0 })
                        : t('avl.flow.summary', {
                            traits: flow.units.reduce((n, u) => n + u.traits.length + u.renderPieces.length, 0),
                            own: flow.units.filter((u) => u.column === 'own').length,
                            composed: flow.units.filter((u) => u.column !== 'own').length,
                            pieces: flow.units.reduce((n, u) => n + u.renderPieces.length, 0),
                          })}
                    </Typography>
                  </Box>
                  {selectedUnit ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      rightIcon="chevron-right"
                      data-testid="flow-show-traits"
                      onClick={() => setTraitView({ lens: 'traits', filter: { unit: selectedUnit.name, traits: [...selectedUnit.traits, ...selectedUnit.renderPieces] } })}
                    >
                      {t('avl.flow.showTraits')}
                    </Button>
                  ) : null}
                  <HStack gap="sm" align="center" className="ml-auto">
                    <Box className="w-2.5 h-2.5 rounded-sm bg-primary" />
                    <Typography variant="caption" color="muted">{t('avl.flow.legendInto')}</Typography>
                    <Box className="w-2.5 h-2.5 rounded-sm bg-warning" />
                    <Typography variant="caption" color="muted">{t('avl.flow.legendOut')}</Typography>
                  </HStack>
                </>
              ) : traitFilter ? (
                <Box className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card/80 border border-border/40" data-testid="trait-filter">
                  <Typography variant="small">{t('avl.flow.showing', { name: traitFilter.unit, count: traitFilter.traits.size })}</Typography>
                  <Button variant="ghost" size="sm" onClick={() => setTraitView({ lens: 'traits', filter: null })} data-testid="trait-filter-clear">{t('avl.flow.showAll')}</Button>
                </Box>
              ) : (
                <Box className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card/80 border border-border/40">
                  <Typography variant="small" className="font-medium">{initialOrbital ?? t('canvas.overview')}</Typography>
                  <Typography variant="small" className="text-muted-foreground">{t('canvas.modulesCount', { count: nodes.length })}</Typography>
                </Box>
              )}
            </>
          ) : (
            <Box className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card/80 border border-border/40 backdrop-blur-sm">
              <Typography variant="small" className="font-medium">
                {traitLevel ? (initialOrbital ?? t('canvas.overview')) : t('canvas.overview')}
              </Typography>
              <Typography variant="small" className="text-muted-foreground">
                {t('canvas.modulesCount', { count: nodes.length })}
              </Typography>
            </Box>
          )}

          {/* Screen size: one dropdown on phones, the preset buttons above sm */}
          {!systemLevel && !flowLens && (<>
          <Box className="sm:hidden ml-auto">
            <Select
              options={screenSizeKeys.map((size) => ({ value: size, label: t('flowCanvas.presetSize', { label: t(SCREEN_SIZE_PRESETS[size].labelKey), width: SCREEN_SIZE_PRESETS[size].width }) }))}
              value={screenSize}
              onValueChange={(value) => { if (typeof value === 'string' && isScreenSize(value)) applyScreenSize(value); }}
              aria-label={t('canvas.screenSize')}
              data-testid="canvas-screen-size-picker"
              className="h-10 py-0 text-sm bg-card/80"
            />
          </Box>
          <Box className="hidden sm:flex ml-auto" data-testid="canvas-screen-size-buttons">
            <ButtonGroup variant="segmented" className="bg-card/80 backdrop-blur-sm rounded-md">
              {screenSizeKeys.map((size) => {
                const p = SCREEN_SIZE_PRESETS[size];
                return (
                  <Button
                    key={size}
                    variant={screenSize === size ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => applyScreenSize(size)}
                    title={t('flowCanvas.presetSize', { label: t(p.labelKey), width: p.width })}
                    aria-label={t('canvas.switchToView', { label: t(p.labelKey) })}
                    aria-pressed={screenSize === size}
                  >
                    {t(p.labelKey)}
                  </Button>
                );
              })}
            </ButtonGroup>
          </Box>
          </>)}
        </Box>)}
      {/* The canvas and the inline inspector share this row; the toolbar above
          keeps its width when the inspector opens, so the cards never shift. */}
      <Box className="flex flex-1 min-h-0">
      <Box
        className="relative flex-1 min-w-0 h-full outline-none focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring focus-visible:ring-inset flex flex-col"
        tabIndex={0}
        onKeyDown={handleCanvasKeyDown}
        data-testid="flow-canvas"
      >
        <Box className="relative flex-1 min-h-0">
        <AvlGraphCanvas
          nodes={nodes}
          edges={visibleEdges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES_LOCAL}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onConnect={handleConnect}
          onNodeDragStop={handleNodeDragStop}
          fitPadding={fitPadding}
          compact={compact}
          nodesDraggable={scope === 'world'}
          elementsSelectable
        />
        </Box>

      </Box>

      {/* OrbInspector (contextual, shows when something is selected).
          On mobile/tablet (<lg) it overlays the canvas from the right with a
          backdrop, so the canvas isn't crushed to 35px next to a fixed
          340px sibling. At lg+ it returns to the inline flex-sibling layout.
          Suppressed when `externalInspector` is set — the consumer renders
          its own panel outside the canvas, fed by `onSelectedNodeChange`. */}
      {!externalInspector && selectedNode && (
        <>
          <Box
            className="fixed inset-0 bg-foreground/40 z-40 lg:hidden"
            onClick={handleClosePanel}
          />
          <Box className="fixed inset-y-0 right-0 z-50 max-w-full lg:static lg:z-auto lg:max-w-none lg:flex-shrink-0">
            <OrbInspector
              node={selectedNode}
              schema={parsedSchema}
              editable={editable}
              userType={userType}
              themeManifest={themeManifest}
              onSchemaChange={onSchemaChange}
              onClose={handleClosePanel}
            />
          </Box>
        </>
      )}
      </Box>
      </Box>
    </TraitCardSelectionContext.Provider>
    </PatternSelectionContext.Provider>
    </ElementEditAccessContext.Provider>
    </SystemMapContext.Provider>
    </CanvasCardWidthContext.Provider>
    </CanvasVerifyContext.Provider>
    </CanvasStatePickerContext.Provider>
    </CanvasToolsContext.Provider>
    </ScreenSizeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Public component with ReactFlowProvider wrapper
// ---------------------------------------------------------------------------

export const FlowCanvas: React.FC<FlowCanvasProps> = (props) => {
  return (
    <Profiler id="flow-canvas" onRender={profilerOnRender}>
      <ReactFlowProvider>
        <FlowCanvasInner {...props} />
      </ReactFlowProvider>
    </Profiler>
  );
};

FlowCanvas.displayName = 'FlowCanvas';
