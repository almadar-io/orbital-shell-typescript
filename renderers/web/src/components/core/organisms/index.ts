// Shared organism types — base props contract for all entity-display organisms
export { type DisplayStateProps, EntityDisplayEvents, type SortPayload, type PaginatePayload, type SearchPayload, type FilterPayload, type SelectPayload } from "./types";

// Shell organisms - common UI patterns
export { StatCard, type StatCardProps } from "./StatCard";

export {
  DetailPanel,
  type DetailPanelProps,
  type DetailField,
  type DetailSection,
} from "./DetailPanel";

// Migrated organisms
export { Form, type FormProps } from "./Form";


// Dialog organisms

// Orbital visualization

// State machine visualization
export {
  StateMachineView,
  DomStateMachineVisualizer,
  OrbitalStateMachineView,
  type StateMachineViewProps,
} from "./StateMachineView";

// Jazari state machine visualization

// Content rendering

// Book viewer

// Layout organisms
export * from "./layout";

// Game organisms
export * from "../../game/molecules";

// UI Slot system
export {
  UISlotRenderer,
  UISlotComponent,
  SlotContentRenderer,
  renderPatternValue,
  type UISlotRendererProps,
  type UISlotComponentProps,
} from "./UISlotRenderer";
export { ModalSlot, type ModalSlotProps } from "./ModalSlot";
export { DrawerSlot, type DrawerSlotProps } from "./DrawerSlot";
export { ToastSlot, type ToastSlotProps } from "./ToastSlot";

// Phase 7b - New core pattern organisms

export {
  Timeline,
  type TimelineProps,
  type TimelineItem,
  type TimelineItemStatus,
} from "./Timeline";
export {
  MediaGallery,
  type MediaGalleryProps,
  type MediaItem,
} from "./MediaGallery";

// Debug organisms
export {
  RuntimeDebugger,
  type RuntimeDebuggerProps,
  MachinePanel,
  type MachinePanelProps,
  type DescribeTrait,
} from "./debug";

// Generative-UI primitives (math/code/lesson)
export {
  CodeRunnerPanel,
  type CodeRunnerPanelProps,
  type CodeSimulationOutput,
} from './CodeRunnerPanel';
export {
  SegmentRenderer,
  type SegmentRendererProps,
  type LessonUserProgress,
} from './SegmentRenderer';

// Agent-trace organisms (promoted from apps/builder). Read the agent-trace
// view-model (Trace* types) from @almadar/core; own no transport.
export { ChatBar, type ChatBarProps, type ChatBarStatus, type ChatFocusRequest } from './ChatBar';
export {
  ELEMENT_SELECTED_EVENT,
  parseEditFocus,
} from './trace-edit-focus';
export {
  SubagentTracePanel,
  type SubagentTracePanelProps,
  type TraceDisclosureLevel,
} from './SubagentTracePanel';

// Phase 10: organisms moved to molecules (no entity binding) or expressed in std render-ui (domain-shaped).

