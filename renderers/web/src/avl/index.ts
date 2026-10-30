/**
 * @almadar/ui/avl
 *
 * Almadar Visual Language (AVL) — Formal visual notation for .orb constructs.
 * V3: Unified with React Flow. AVL primitives render inside React Flow nodes.
 */

// AVL Atoms - Tier 1: Structural Primitives
export { AvlOrbital, type AvlOrbitalProps } from '../components/avl/atoms';
export { AvlEntity, type AvlEntityProps } from '../components/avl/atoms';
export { AvlTrait, type AvlTraitProps } from '../components/avl/atoms';
export { AvlPage, type AvlPageProps } from '../components/avl/atoms';
export { AvlApplication, type AvlApplicationProps } from '../components/avl/atoms';

// AVL Atoms - Tier 2: Behavioral Primitives
export { AvlState, type AvlStateProps } from '../components/avl/atoms';
export { AvlTransition, type AvlTransitionProps } from '../components/avl/atoms';
export { AvlEvent, type AvlEventProps } from '../components/avl/atoms';
export { AvlGuard, type AvlGuardProps } from '../components/avl/atoms';
export { AvlEffect, type AvlEffectProps } from '../components/avl/atoms';

// AVL Atoms - Tier 3: Data Primitives
export { AvlField, type AvlFieldProps } from '../components/avl/atoms';
export { AvlFieldType, type AvlFieldTypeProps } from '../components/avl/atoms';
export { AvlBinding, type AvlBindingProps } from '../components/avl/atoms';
export { AvlPersistence, type AvlPersistenceProps } from '../components/avl/atoms';

// AVL Atoms - Tier 4: Expression Primitives
export { AvlOperator, type AvlOperatorProps } from '../components/avl/atoms';
export { AvlSExpr, type AvlSExprProps } from '../components/avl/atoms';
export { AvlLiteral, type AvlLiteralProps } from '../components/avl/atoms';
export { AvlBindingRef, type AvlBindingRefProps } from '../components/avl/atoms';

// AVL drawing contract + classification (kinds come from @almadar/core / @almadar/std)
export type { AvlBaseProps, StateRole, EffectCategory } from '../components/avl/atoms';
export {
  STATE_COLORS,
  EFFECT_CATEGORY_COLORS,
  OPERATOR_CATEGORY_COLORS,
  CONNECTION_COLORS,
  getStateRole,
  effectCategoryOf,
  FIELD_TYPE_SHAPES,
  type FieldTypeShape,
} from '../components/avl/atoms';

// AVL Molecules (SVG composites)
export { AvlStateMachine, type AvlStateMachineProps } from '../components/avl/molecules';
export { AvlCircuit, type AvlCircuitProps } from '../components/avl/molecules';
export { AvlGlyph, AVL_GLYPH_KINDS, type AvlGlyphProps, type AvlGlyphKind } from '../components/avl/molecules';
export { AvlOrbitalUnit, type AvlOrbitalUnitProps, type AvlOrbitalUnitTrait, type AvlOrbitalUnitPage } from '../components/avl/molecules';
export { AvlClosedCircuit, type AvlClosedCircuitProps, type AvlClosedCircuitState, type AvlClosedCircuitTransition } from '../components/avl/molecules';
export { AvlEmitListen, type AvlEmitListenProps } from '../components/avl/molecules';
export { AvlSlotMap, type AvlSlotMapProps, type AvlSlotMapSlot } from '../components/avl/molecules';
export { AvlExprTree, type AvlExprTreeProps, type AvlExprTreeNode } from '../components/avl/molecules';
export { AvlBehaviorGlyph, type AvlBehaviorGlyphProps, type BehaviorLevel, type GlyphSize, type BehaviorGlyphChild, type BehaviorGlyphConnection, DOMAIN_COLORS } from '../components/avl/molecules';
export { AvlTransitionLane, type AvlTransitionLaneProps } from '../components/avl/molecules';
export { AvlSwimLane, type AvlSwimLaneProps } from '../components/avl/molecules';

// Layout utilities
export { ringPositions, arcPath, radialPositions, gridPositions, curveControlPoint } from '../components/avl/molecules';

// V3: Canvas types
export { type ZoomBand, ZOOM_BAND_THRESHOLDS } from '../lib/avl-zoom-band';
export { type AvlNodeData, type AvlEdgeData } from '../lib/avl-flow-converter';
export { computeZoomBand, zoomProgress, useZoomBand, ZoomBandContext } from '../lib/avl-zoom-band';
export { schemaToFlowGraph } from '../lib/avl-flow-converter';

// V3: React Flow node types
export { SystemNode, SystemBandNode, DependencyNode, DependencyColumnNode, SystemMapContext, type SystemMapContextValue } from '../components/avl/molecules/SystemNode';
export { ModuleCard } from '../components/avl/molecules/ModuleCard';
export { MiniStateMachine } from '../components/avl/molecules/MiniStateMachine';
export { BehaviorView } from '../components/avl/molecules/BehaviorView';
export { DetailView } from '../components/avl/molecules/DetailView';

// V3: React Flow edge types
export { AvlTransitionEdge, type AvlTransitionEdgeData } from '../components/avl/molecules/AvlTransitionEdge';
export { AvlEventWireEdge, type AvlEventWireEdgeData } from '../components/avl/molecules/AvlEventWireEdge';
export { AvlBackwardEdge } from '../components/avl/molecules/AvlBackwardEdge';
export { AvlPageEdge } from '../components/avl/molecules/AvlPageEdge';
export { AvlBindingEdge } from '../components/avl/molecules/AvlBindingEdge';

// V3: ELK layout (shared)
export { computeTraitLayout, edgePath, type LayoutNode, type LayoutEdge, type ElkLayout } from '../lib/avl-elk-layout';

// V3 Revised: UI Projection components
export { type ViewLevel, type PreviewNodeData, type EventEdgeData, type PatternEventSource, type RenderUIEntry } from '../lib/avl-preview-converter';
export { schemaToOverviewGraph, stateOptionsOf, canvasViewGraph, initialStateOf, optionForPlayedStep, LIVE_STATE, type PlayedStep, type CanvasStateView, type CanvasStateOption, type CanvasStateGroup, type CanvasStateOptions, type CanvasViewOptions } from '../lib/avl-preview-converter';
export { OrbPreviewNode, CanvasVerifyContext, type SelectedPattern, type CanvasVerify, type CanvasStepReached, type CardVerdict } from '../components/avl/molecules/OrbPreviewNode';
export { EventFlowEdge } from '../components/avl/molecules/EventFlowEdge';

// DOM → EditFocus (inspect primitive). Reads `data-orb-*` (incl. `data-orb-orbital`
// stamped by UISlotRenderer) off a clicked element so consumers (runtime-verify
// catalog, studio chatbox) can turn a rendered node into an EditFocus.
export { deriveEditFocusFromElement } from '../lib/derive-edit-focus';
export { useInlineTextEdit, type InlineTextEditOptions } from '../hooks/useInlineTextEdit';

// Canvas DnD (mirrors useDataDnd; pointer-sensor based so it works inside
// React Flow nodes — the HTML5 DnD path was swallowed by RF's pan/zoom).
export {
  CanvasDndProvider,
  dropBusEvent,
  useCanvasDraggable,
  useCanvasDroppable,
  type CanvasDragKind,
  type CanvasDragPayload,
  type CanvasContainerNode,
  type CanvasDropTarget,
  type CanvasDropEvent,
  type CanvasResolvedDrop,
  type CanvasDndProviderProps,
  type UseCanvasDraggableArgs,
  type UseCanvasDraggableResult,
  type UseCanvasDroppableArgs,
  type UseCanvasDroppableResult,
} from '../hooks/useCanvasDnd';

// V3 Revised: Behavior Compose

// OrbInspector
export { OrbInspector, type OrbInspectorProps } from '../components/avl/organisms/OrbInspector';

// LayersPanel
export {
  LayersPanel,
  type LayersPanelProps,
  schemaToLayerItems,
  parseLayerId,
  type LayerIdParts,
} from '../components/avl/organisms/LayersPanel';

// AVL Organisms — Interactive Cosmic Zoom
export {
  FlowCanvas,
  type FlowCanvasProps,
  type CanvasScope,
  type CanvasFocusChange,
  ZoomBreadcrumb,
  type ZoomBreadcrumbProps,
  ZoomLegend,
  type ZoomLegendProps,
  AvlCosmicZoom,
  type AvlCosmicZoomProps,
  AvlOrbitalsCosmicZoom,
  type AvlOrbitalsCosmicZoomProps,
  AvlTraitScene,
  type AvlTraitSceneProps,
  AvlTransitionScene,
  type AvlTransitionSceneProps,
  AvlClickTarget,
  type AvlClickTargetProps,
  parseApplicationLevel,
  parseOrbitalLevel,
  parseTraitLevel,
  parseTransitionLevel,
  type ApplicationLevelData,
  type OrbitalLevelData,
  type TraitLevelData,
  type TransitionLevelData,
  type CrossLink,
  type ZoomLevel,
} from '../components/avl/organisms';
export { AvlTransitionDetail, type AvlTransitionDetailProps } from '../components/avl/molecules/AvlTransitionDetail';
export { AvlTransitionExplainer, type AvlTransitionExplainerProps } from '../components/avl/molecules/AvlTransitionExplainer';
export { AvlEffectChip, type AvlEffectChipProps } from '../components/avl/molecules/AvlEffectChip';
export type { AvlAnnotations, AvlNote } from '../lib/avl-annotations';
export { AvlGraphCanvas, AVL_GRAPH_NODE_TYPES, type AvlGraphCanvasProps } from '../components/avl/organisms/AvlGraphCanvas';
export { traitLevelFromTrait, type TraitTransitionInfo } from '../lib/avl-schema-parser';
export {
  armsOf,
  armPosition,
  firedTransition,
  stateMachinePlayback,
  transitionPlayback,
  type AvlPlayStep,
  type AvlStepRequest,
  type AvlStateMachinePlayback,
  type AvlTransitionPlayback,
} from '../lib/avl-play';
export { schemaToDependencyGraph, dependencyReach, type SystemDependencies, type DependencyLayer } from '../lib/avl-dependency-graph';
export { deploymentGraph, DEPLOYMENT_ROW } from '../lib/avl-deployment-graph';
export { layeredGraph, type LayeredGraphInput, type LayeredColumn, type LayeredColumnId, type LayeredUnit, type LayeredEdge, type LayeredRow } from '../lib/avl-layered-graph';
export { traitFlowGraph, flowNeighbors, type TraitFlowUnit, type TraitFlowEdge } from '../lib/avl-trait-flow';
export { type TraitView } from '../components/avl/organisms/FlowCanvas';
export { CANVAS_TOOLS, hasCanvasTool, type CanvasTool } from '../lib/canvas-tools';
export { KnobField, type KnobFieldProps } from '../components/avl/molecules/KnobField';
export { KnobSettingRow, type KnobSettingRowProps } from '../components/avl/molecules/KnobSettingRow';
export {
  ElementEditAccessContext,
  EDITABLE,
  propAccessAt,
  type ElementEditAccess,
  type ElementEditAccessResolver,
  type ElementKnob,
  type ElementPropAccess,
  type ElementSettings,
} from '../lib/element-edit-access';

// Typed decoders for the AVL organisms' rich props (compiled-app boundary)
export { decodePreviewNodeData, decodeSelectedPattern, decodeNodePlacements } from '../lib/avl-prop-decoders';
