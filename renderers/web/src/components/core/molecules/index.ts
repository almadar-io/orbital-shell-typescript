export { ErrorBoundary, type ErrorBoundaryProps } from './ErrorBoundary';
export { JsonTreeEditor, type JsonTreeEditorProps } from './JsonTreeEditor';
export { NodeSlotEditor, type NodeSlotEditorProps } from './NodeSlotEditor';
export { FileTree, type FileTreeProps, type FileTreeNode, type FileTreeItem } from './FileTree';
export { FormField, type FormFieldProps } from './FormField';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { LoadingState, type LoadingStateProps } from './LoadingState';
export { ErrorState, type ErrorStateProps } from './ErrorState';
export { Skeleton, SkeletonTree, type SkeletonProps, type SkeletonVariant } from './Skeleton';

// Migrated molecules
export { Accordion, type AccordionProps, type AccordionItem } from './Accordion';
export { Alert, type AlertProps, type AlertVariant } from './Alert';
export { Breadcrumb, type BreadcrumbProps, type BreadcrumbItem } from './Breadcrumb';
export { ButtonGroup, type ButtonGroupProps } from './ButtonGroup';
export { CommandPalette, dispatchCommandPaletteCommand, type CommandPaletteProps, type CommandPaletteCommand, type DispatchCommandPaletteCommandDeps } from './CommandPalette';
export { FilterGroup, type FilterGroupProps, type FilterDefinition } from './FilterGroup';
export { Card as ActionCard, type CardProps as ActionCardProps, type CardAction } from './Card';
export { Container, type ContainerProps } from './Container';
export { Flex, type FlexProps } from './Flex';
export { FloatingActionButton, type FloatingActionButtonProps, type FloatingAction } from './FloatingActionButton';
export { Grid, type GridProps } from './Grid';
export { InputGroup, type InputGroupProps } from './InputGroup';
export { Menu, type MenuProps, type MenuItem } from './Menu';
export { TopNavItem, type TopNavItemProps, type TopNavItemData } from './TopNavItem';
export { Modal, type ModalProps, type ModalSize } from './Modal';
export { PageTransition, type PageTransitionProps } from './PageTransition';
export { FxOverlay, type FxOverlayProps } from './FxOverlay';
export { Pagination, type PaginationProps } from './Pagination';
export { Popover, type PopoverProps } from './Popover';
export {
  Coachmark,
  useAnchorRect,
  type CoachmarkProps,
  type CoachmarkPlacement,
  type CoachmarkAnchor,
} from './Coachmark';
export {
  OnboardingSpotlight,
  type OnboardingSpotlightProps,
  type SpotlightStep,
} from './OnboardingSpotlight';
export { RelationSelect, type RelationSelectProps, type RelationOption } from './RelationSelect';
export { SearchInput, type SearchInputProps } from './SearchInput';
export { SidePanel, type SidePanelProps } from './SidePanel';
export { SimpleGrid, type SimpleGridProps } from './SimpleGrid';
export { Tabs, type TabsProps, type TabItem } from './Tabs';
export { Toast, type ToastProps, type ToastVariant } from './Toast';
export { Tooltip, type TooltipProps } from './Tooltip';
export { IconButton, type IconButtonProps } from './IconButton';
export { ActivityRail, type ActivityRailProps, type ActivityRailItem } from './ActivityRail';
export { Drawer, type DrawerProps, type DrawerPosition, type DrawerSize } from './Drawer';
export { WizardProgress, type WizardProgressProps, type WizardProgressStep } from './WizardProgress';
export { WizardNavigation, type WizardNavigationProps } from './WizardNavigation';

// Markdown components
export { MarkdownContent, type MarkdownContentProps } from './markdown/MarkdownContent';
export {
  CodeBlock,
  type CodeBlockProps,
  type CodeLanguage,
  type CodeViewerMode,
  type DiffLine,
  type CodeViewerFile,
  type CodeViewerAction,
  toCodeLanguage,
  registerCodeLanguageLoader,
  preloadCodeHighlighter,
  applyCompletion,
  type CodeCompletion,
  type CodeCompletionProvider,
  type CodeCompletionResult,
  applySuggestions,
  type CodeSuggestion,
  type CodeAssistProvider,
  type CodeAssistRequest,
  type CodeAssistResult,
  type CodeDiagnostic,
  type CodeLanguageLoader,
  type PrismLanguageGrammar,
} from './markdown/CodeBlock';

// Quiz
export { QuizBlock, type QuizBlockProps } from './QuizBlock';

// Diagram scaling
export { ScaledDiagram, type ScaledDiagramProps } from './ScaledDiagram';

// Calendar
export { CalendarGrid, type CalendarGridProps } from './CalendarGrid';

// Gantt / timeline schedule
export { Gantt, type GanttProps, type GanttLink } from './Gantt';

// Inspection form components
export { RepeatableFormSection, type RepeatableFormSectionProps, type RepeatableItem } from './RepeatableFormSection';
export { ViolationAlert, type ViolationAlertProps, type ViolationRecord } from './ViolationAlert';
export { FormSectionHeader, type FormSectionHeaderProps } from './FormSectionHeader';
export { FlipCard, type FlipCardProps } from './FlipCard';
export {
  GridPicker,
  type GridPickerProps,
  type PickerItem,
  type GridPickerCellSize,
} from './GridPicker';
export { AssetPicker, type AssetPickerProps } from './AssetPicker';
export { IconPicker, type IconPickerProps } from './IconPicker';
export {
  EmojiPicker,
  type EmojiPickerProps,
  type EmojiPickerPosition,
} from './EmojiPicker';

// Chart molecules
export { DateRangePicker, type DateRangePickerProps, type DateRangePickerPreset } from './DateRangePicker';
export { DateRangeSelector, type DateRangeSelectorProps, type DateRangeSelectorOption } from './DateRangeSelector';
export { ChartLegend, type ChartLegendProps, type ChartLegendItem } from './ChartLegend';
export { LineChart, type LineChartProps, type ChartDataPoint } from './LineChart';
export { ProgressDots, type ProgressDotsProps, type DotState, type DotSize } from './ProgressDots';

// Game molecules
export * from '../../game/molecules';

// Learning canvas molecules
export {
  MathCanvas,
  type MathCanvasProps,
  type MathCurve,
  type MathPoint,
  type MathVector,
} from '../../learning/molecules/MathCanvas';
export {
  PhysicsCanvas,
  type PhysicsCanvasProps,
  type LearningPhysicsBody,
  type LearningPhysicsConstraint,
} from '../../learning/molecules/PhysicsCanvas';
export {
  BiologyCanvas,
  type BiologyCanvasProps,
  type BiologyNode,
  type BiologyEdge,
} from '../../learning/molecules/BiologyCanvas';
export {
  ChemistryCanvas,
  type ChemistryCanvasProps,
  type ChemistryAtom,
  type ChemistryBond,
  type ChemistryArrow,
} from '../../learning/molecules/ChemistryCanvas';
export {
  AlgorithmCanvas,
  type AlgorithmCanvasProps,
  type AlgorithmBar,
  type AlgorithmCell,
  type AlgorithmPointer,
} from '../../learning/molecules/AlgorithmCanvas';
export {
  AlgoGraphCanvas,
  type AlgoGraphCanvasProps,
  type AlgoGraphNode,
  type AlgoGraphEdge,
  type AlgoGraphNodeBadge,
  type AlgoGraphNodeState,
  type AlgoGraphEdgeState,
  type AlgoGraphLayout,
} from '../../learning/molecules/AlgoGraphCanvas';
export {
  LearningScene3D,
  type LearningScene3DProps,
  type Learning3DPoint,
  type MeshSphereOpts,
  meshSphere,
  cylinderBetween,
  arrowBetween,
  billboardLabel,
  get3DClickPayload,
} from '../../learning/molecules/learningScene3D';

// Graph visualization
export { GraphView, type GraphViewProps, type GraphViewNode, type GraphViewEdge } from './GraphView';

// Map visualization
export { MapView, type MapViewProps, type MapMarkerData, type MapRouteData, type MapRouteWaypoint } from './MapView';

// UX Phase 1 molecules
export { NumberStepper, type NumberStepperProps, type NumberStepperSize } from './NumberStepper';
export { StarRating, type StarRatingProps, type StarRatingSize, type StarRatingPrecision } from './StarRating';
export { UploadDropZone, type UploadDropZoneProps } from './UploadDropZone';
export { Lightbox, type LightboxProps, type LightboxImage } from './Lightbox';

// Data iteration molecules (simplified from organisms)
export { DataGrid, type DataGridProps, type DataGridField, type DataGridItemAction } from './DataGrid';
export { DataList, type DataListProps, type DataListField, type DataListItemAction } from './DataList';
export { TableView, type TableViewProps, type TableViewColumn } from './TableView';

// Stat display molecule (behavior-safe replacement for StatCard organism)
export { StatDisplay, type StatDisplayProps } from './StatDisplay';

// Meter molecule (relocated from organisms - no entity prop)
export { Meter, type MeterProps, type MeterVariant, type MeterThreshold, type MeterAction } from './Meter';

// UX Phase 5 molecules
export { SwipeableRow, type SwipeableRowProps, type SwipeAction } from './SwipeableRow';
export { SortableList, type SortableListProps } from './SortableList';

// Carousel and PullToRefresh
export { Carousel, type CarouselProps } from './Carousel';
export { PullToRefresh, type PullToRefreshProps } from './PullToRefresh';

export { FeatureCard, type FeatureCardProps } from './FeatureCard';
export { FeatureGrid, type FeatureGridProps } from './FeatureGrid';
export { AnimatedCounter, type AnimatedCounterProps } from './AnimatedCounter';
export { SocialProof, type SocialProofProps, type SocialProofItem } from './SocialProof';
export { TagInput, type TagInputProps } from './TagInput';

// Decorative pattern molecules
export { GeometricPattern, type GeometricPatternProps } from './GeometricPattern';
export { EdgeDecoration, type EdgeDecorationProps, type EdgeVariant, type EdgeSide } from './EdgeDecoration';

// Phase 10 molecules — generic primitives (community/forum, survey, content authoring, layout)
export { VoteStack, type VoteStackProps } from './VoteStack';
export { LikertScale, type LikertScaleProps, type LikertOption, DEFAULT_LIKERT_OPTION_KEYS } from './LikertScale';
export { MatrixQuestion, type MatrixQuestionProps, type MatrixRow, type MatrixColumn, DEFAULT_MATRIX_COLUMN_KEYS } from './MatrixQuestion';
export { QrScanner, type QrScannerProps, type QrScanResult } from './QrScanner';
export { OptionConstraintGroup, type OptionConstraintGroupProps, type OptionConstraintOption, type OptionConstraint } from './OptionConstraintGroup';
export { PositionedCanvas, type PositionedCanvasProps, type CanvasItemStatus, type CanvasItemShape } from './PositionedCanvas';
// Demoted from organisms — no entity binding
export { RichTextEditor, sanitizeRichHtml, type RichTextEditorProps } from './RichTextEditor';
export { DocumentPanel, type DocumentPanelProps, type DocumentPanelAction } from './DocumentPanel';
export { DocumentDetails, type DocumentDetailsProps, type DocumentDetailsField } from './DocumentDetails';
export { ReplyTree, type ReplyTreeProps } from './ReplyTree';
export { BranchingLogicBuilder, type BranchingLogicBuilderProps, type BranchingQuestion, type BranchingRule } from './BranchingLogicBuilder';
export { CommitRow, type CommitRowProps, type CommitKind } from './CommitRow';
export { ChangeList, type ChangeListProps, type ChangeListItem, type ChangeType } from './ChangeList';
export { VersionDiff, type VersionDiffProps, type DiffRevision, type DiffHunk, type DiffLine as VersionDiffLine, type DiffLineType } from './VersionDiff';

// Documentation molecules — public surface for std behaviors that render
// help-center / docs-style content (std-public-help-center,
// std-document-mgmt). Promoted alongside the G7 pattern-sync export filter.
export { DocBreadcrumb, type DocBreadcrumbProps, type DocBreadcrumbItem } from './DocBreadcrumb';
export { DocPagination, type DocPaginationProps, type DocPaginationLink } from './DocPagination';
export { DocSearch, type DocSearchProps, type DocSearchResult } from './DocSearch';
export { DocSidebar, type DocSidebarProps, type DocSidebarItem } from './DocSidebar';
export { DocTOC, type DocTOCProps, type DocTOCItem } from './DocTOC';

export { GradientDivider, type GradientDividerProps } from './GradientDivider';

// AVL (Almadar Visual Language) molecules surfaced for std behaviors
// (behavior-view, module-card).
export { BehaviorView, type BehaviorViewProps } from '../../avl/molecules/BehaviorView';
export { ModuleCard, type ModuleCardProps } from '../../avl/molecules/ModuleCard';

// Relocated from organisms (presentational — no entity manipulation)
export {
  PageHeader,
  type PageHeaderProps,
  type PageBreadcrumb,
} from "./PageHeader";
export {
  FormSection,
  FormLayout,
  FormActions,
  type FormSectionProps,
  type FormLayoutProps,
  type FormActionsProps,
} from "./FormSection";
export { PropertyInspector, type PropertyInspectorProps } from "./PropertyInspector";
export { Header, type HeaderProps } from "./Header";
export {
  Navigation,
  type NavigationProps,
  type NavigationItem,
} from "./Navigation";
export { Section, type SectionProps } from "./Section";
export { Sidebar, type SidebarProps, type SidebarItem } from "./Sidebar";
export { Split, type SplitProps } from "./Split";
export {
  ConfirmDialog,
  type ConfirmDialogProps,
  type ConfirmDialogVariant,
} from "./ConfirmDialog";
export {
  WizardContainer,
  type WizardContainerProps,
  type WizardStep,
} from "./WizardContainer";
export {
  OrbitalVisualization,
  type OrbitalVisualizationProps,
} from "./OrbitalVisualization";
export {
  JazariStateMachine,
  type JazariStateMachineProps,
} from "./JazariStateMachine";
export {
  ContentRenderer,
  type ContentRendererProps,
} from "./ContentRenderer";
export {
  Chart,
  type ChartProps,
  type ChartType,
  type ChartSeries,
} from "./Chart";
export {
  SignaturePad,
  type SignaturePadProps,
} from "./SignaturePad";
export {
  DocumentViewer,
  type DocumentViewerProps,
  type DocumentType,
} from "./DocumentViewer";
export {
  GraphCanvas,
  type GraphCanvasProps,
  type GraphNode,
  type GraphEdge,
  type GraphSimilarity,
} from "./GraphCanvas";

// Import (migration) molecules
export * from './import';

// Learning-science molecules (generative-UI primitives)
export { ActivationBlock, type ActivationBlockProps } from './ActivationBlock';
export { ReflectionBlock, type ReflectionBlockProps } from './ReflectionBlock';
export { ConnectionBlock, type ConnectionBlockProps } from './ConnectionBlock';
export { BloomQuizBlock, type BloomQuizBlockProps, type BloomLevel } from './BloomQuizBlock';
export { parseLessonSegments, type LessonSegment } from '../../../lib/parseLessonSegments';
export type { LessonUserProgress } from '../organisms/SegmentRenderer';
export { parseMarkdownWithCodeBlocks, type MixedSegment } from '../../../lib/lessonSegmentUtils';

// Floating tool strip (Figma UI3-style pill), composed from Button/ButtonGroup/Divider
export { FloatingToolbar, type FloatingToolbarProps, type FloatingToolbarItem, type FloatingToolbarPosition } from './FloatingToolbar';

// Agent activity feed (the TraceActivity rows a chat surface renders), promoted from apps/builder
export {
  AgentActivityFeed,
  AgentActivityRow,
  AgentThinkingRow,
  activityRowFacts,
  groupIntoConversations,
  type AgentActivityFeedProps,
  type AgentActivityRowProps,
  type AgentActivityJumpTarget,
  type AgentConversation,
  type RowFacts,
} from './AgentActivityFeed';
export { AgentChatFeed, type AgentChatFeedProps } from './AgentChatFeed';
