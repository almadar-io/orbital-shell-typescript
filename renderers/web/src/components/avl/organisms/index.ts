/**
 * AVL Organisms - Interactive orbital visualizations.
 *
 * V3: FlowCanvas is the primary organism. AvlCosmicZoom delegates to it.
 *
 * @packageDocumentation
 */

// Primary V3 organisms
export { FlowCanvas, type FlowCanvasProps, type CanvasScope, type CanvasFocusChange } from './FlowCanvas';
export { AvlGraphCanvas, AVL_GRAPH_NODE_TYPES, type AvlGraphCanvasProps } from './AvlGraphCanvas';
export { OrbInspector, type OrbInspectorProps } from './OrbInspector';
export {
  LayersPanel,
  type LayersPanelProps,
  schemaToLayerItems,
  parseLayerId,
  type LayerIdParts,
} from './LayersPanel';
export { ZoomBreadcrumb, type ZoomBreadcrumbProps } from './ZoomBreadcrumb';
export { ZoomLegend, type ZoomLegendProps } from './ZoomLegend';

// Facade (preserves V2 interface)
export { AvlCosmicZoom, type AvlCosmicZoomProps } from './AvlCosmicZoom';

// Pure SVG orbital interaction visualization (for docs, no React Flow)
export { AvlOrbitalsCosmicZoom, type AvlOrbitalsCosmicZoomProps } from './AvlOrbitalsCosmicZoom';

// Retained scene renderers (used by BehaviorView and DetailView internally)
export { AvlTraitScene, type AvlTraitSceneProps } from './AvlTraitScene';
export { AvlTransitionScene, type AvlTransitionSceneProps } from './AvlTransitionScene';

// Utilities
export { AvlClickTarget, type AvlClickTargetProps } from './AvlClickTarget';
export { AvlLegend, type AvlLegendProps } from './AvlLegend';

// Parser
export {
  parseApplicationLevel,
  parseOrbitalLevel,
  parseTraitLevel,
  parseTransitionLevel,
  type ApplicationLevelData,
  type OrbitalLevelData,
  type TraitLevelData,
  type TransitionLevelData,
  type CrossLink,
  type ExprTreeNode,
} from '../../../lib/avl-schema-parser';

// Zoom state
export {
  zoomReducer,
  initialZoomState,
  getBreadcrumbs,
  type ZoomLevel,
  type ZoomState,
  type ZoomAction,
  type BreadcrumbSegment,
} from '../../../lib/avl-zoom-state';
