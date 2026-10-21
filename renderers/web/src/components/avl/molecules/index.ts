export { AvlStateMachine, type AvlStateMachineProps } from './AvlStateMachine';
export { AvlCircuit, type AvlCircuitProps } from './AvlCircuit';
export { AvlGlyph, AVL_GLYPH_KINDS, type AvlGlyphProps, type AvlGlyphKind } from './AvlGlyph';
export { AvlOrbitalUnit, type AvlOrbitalUnitProps, type AvlOrbitalUnitTrait, type AvlOrbitalUnitPage } from './AvlOrbitalUnit';
export { AvlClosedCircuit, type AvlClosedCircuitProps, type AvlClosedCircuitState, type AvlClosedCircuitTransition } from './AvlClosedCircuit';
export { AvlEmitListen, type AvlEmitListenProps } from './AvlEmitListen';
export { AvlSlotMap, type AvlSlotMapProps, type AvlSlotMapSlot } from './AvlSlotMap';
export { AvlExprTree, type AvlExprTreeProps, type AvlExprTreeNode } from './AvlExprTree';
export { AvlTransitionLane, type AvlTransitionLaneProps, type AvlTransitionLaneEffect } from './AvlTransitionLane';
export { AvlSwimLane, type AvlSwimLaneProps } from './AvlSwimLane';
export { AvlBehaviorGlyph, type AvlBehaviorGlyphProps, type BehaviorLevel, type GlyphSize, type BehaviorGlyphChild, type BehaviorGlyphConnection, DOMAIN_COLORS } from './AvlBehaviorGlyph';
export { ringPositions, arcPath, radialPositions, gridPositions, curveControlPoint } from '../../../lib/avl-layout';

// V3: Canvas types + utilities
export { type ZoomBand, ZOOM_BAND_THRESHOLDS } from '../../../lib/avl-zoom-band';
export { type AvlNodeData, type AvlEdgeData, type AvlEdgeKind } from '../../../lib/avl-flow-converter';
export { computeZoomBand, zoomProgress, useZoomBand, ZoomBandContext } from '../../../lib/avl-zoom-band';
export { schemaToFlowGraph } from '../../../lib/avl-flow-converter';
export { computeTraitLayout, edgePath, stateWidth, STATE_H, type LayoutNode, type LayoutEdge, type ElkLayout } from '../../../lib/avl-elk-layout';

// V3: React Flow node components
export { SystemNode, SystemBandNode, DependencyNode, DependencyColumnNode, SystemMapContext, type SystemMapContextValue } from './SystemNode';
export { MiniStateMachine, type MiniStateMachineProps } from './MiniStateMachine';
export { ModuleCard, type ModuleCardProps } from './ModuleCard';
export { BehaviorView, type BehaviorViewProps } from './BehaviorView';
export { DetailView, type DetailViewProps } from './DetailView';

// V3: React Flow edge components
export { AvlTransitionEdge, type AvlTransitionEdgeData, type AvlTransitionFlowEdge } from './AvlTransitionEdge';
export { AvlEventWireEdge, type AvlEventWireEdgeData, type AvlEventWireFlowEdge } from './AvlEventWireEdge';
export { AvlBackwardEdge } from './AvlBackwardEdge';
export { AvlPageEdge } from './AvlPageEdge';
export { AvlBindingEdge } from './AvlBindingEdge';

// V3 Revised: UI Projection components
export { type ViewLevel, type PreviewNodeData, type EventEdgeData, type PatternEventSource, type RenderUIEntry, type ScreenSize, SCREEN_SIZE_PRESETS } from '../../../lib/avl-preview-converter';
export { schemaToOverviewGraph, stateOptionsOf, canvasViewGraph, initialStateOf, LIVE_STATE, type CanvasStateView, type CanvasStateOption, type CanvasStateGroup, type CanvasStateOptions, type CanvasViewOptions } from '../../../lib/avl-preview-converter';
export { OrbPreviewNode, ScreenSizeContext } from './OrbPreviewNode';
export { EventFlowEdge } from './EventFlowEdge';

// V3 Revised: Behavior Compose components

// 3D Molecules (Three.js dependent - import via game/three barrel for SSR safety)
export { Avl3DOrbitalNode, type Avl3DOrbitalNodeProps } from './Avl3DOrbitalNode';
export { Avl3DCrossWire, type Avl3DCrossWireProps } from './Avl3DCrossWire';
export { Avl3DEntityCore, type Avl3DEntityCoreProps } from './Avl3DEntityCore';
export { Avl3DStateNode, type Avl3DStateNodeProps } from './Avl3DStateNode';
export { Avl3DTransitionArc, type Avl3DTransitionArcProps } from './Avl3DTransitionArc';
export { Avl3DExprTree, type Avl3DExprTreeProps } from './Avl3DExprTree';
