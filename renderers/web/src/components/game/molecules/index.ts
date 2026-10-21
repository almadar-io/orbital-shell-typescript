/**
 * Game 2D Components (flat)
 *
 * Atoms, molecules, board organisms, templates, puzzles, editor, and physics-sim.
 * Dimension-agnostic DTO types/utils/hooks are re-surfaced from ../shared.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Shared (DTO types, projection/animation utils, image cache, combat effects)
// ---------------------------------------------------------------------------
export * from '../../../lib/gameShared';

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------
export { HealthBar, type HealthBarProps } from '../atoms/HealthBar';
export { ScoreDisplay, type ScoreDisplayProps } from '../atoms/ScoreDisplay';
export { ControlButton, type ControlButtonProps } from '../atoms/ControlButton';
export { TimerDisplay, type TimerDisplayProps } from '../atoms/TimerDisplay';
export { DialogueBubble, type DialogueBubbleProps } from '../atoms/DialogueBubble';
export { ChoiceButton, type ChoiceButtonProps } from '../atoms/ChoiceButton';

// ---------------------------------------------------------------------------
// Molecules
// ---------------------------------------------------------------------------
export { ControlGrid, type ControlGridProps, type ControlGridButton, type ControlGridKind, type DPadDirection } from './ControlGrid';
export { StatBadge, type StatBadgeProps } from './StatBadge';
export { GameHud, type GameHudProps, type GameHudStat, type GameHudElement } from './GameHud';
export { GameMenu, type GameMenuProps, type MenuOption } from './GameMenu';
export { StateGraph, type StateGraphProps, type StateGraphTransition } from './StateGraph';
export {
    Canvas2D,
    type Canvas2DProps,
    type Projection,
    type CameraMode,
    type Platform,
    type SidePlayer,
    type TileCoord,
} from './Canvas2D';
export { Canvas, type CanvasProps, type CanvasMode } from './Canvas';
export { useUnitSpriteAtlas } from '../../../hooks/useUnitSpriteAtlas';

// ---------------------------------------------------------------------------
// Audio System
// ---------------------------------------------------------------------------
export {
    GameAudioProvider,
    GameAudioContext,
    useGameAudioContext,
    type GameAudioProviderProps,
    type GameAudioContextValue,
} from '../../../providers/GameAudioProvider';
export {
    GameAudioToggle,
    type GameAudioToggleProps,
} from '../atoms/GameAudioToggle';
export {
    GameAudioCue,
    type GameAudioCueProps,
} from '../atoms/GameAudioCue';
export {
    useGameAudio,
    type AudioManifest,
    type SoundEntry,
    type GameAudioControls,
    type UseGameAudioOptions,
} from '../../../hooks/useGameAudio';

// ---------------------------------------------------------------------------
// 2D Hooks
// ---------------------------------------------------------------------------
export { useCamera } from '../../../hooks/useCamera';
// ---------------------------------------------------------------------------
// Board Organisms (game-logic containers — templates are thin wrappers)
// ---------------------------------------------------------------------------
// All hand-authored game boards are now .lolo game-shell compositions — no React board organisms remain here.

// ---------------------------------------------------------------------------
// Trait / State Machine Visualization
// ---------------------------------------------------------------------------
export {
    TraitStateViewer,
    type TraitStateViewerProps,
    type TraitStateMachineDefinition,
    type TraitTransition,
} from './TraitStateViewer';
export {
    TraitSlot,
    type TraitSlotProps,
    type SlotItemData,
} from './TraitSlot';

// ---------------------------------------------------------------------------
// Editor Utilities (Storybook map editor components)
// ---------------------------------------------------------------------------
export {
    CollapsibleSection,
    EditorSlider,
    EditorSelect,
    EditorCheckbox,
    EditorTextInput,
    StatusBar,
    TerrainPalette,
    EditorToolbar,
    TERRAIN_COLORS,
    FEATURE_TYPES,
    type EditorMode,
    type CollapsibleSectionProps,
    type EditorSliderProps,
    type EditorSelectProps,
    type EditorCheckboxProps,
    type EditorTextInputProps,
    type StatusBarProps,
    type TerrainPaletteProps,
    type EditorToolbarProps,
} from '../../../lib/editorUtils';

// ---------------------------------------------------------------------------
// Puzzle Board Organisms
// ---------------------------------------------------------------------------
// Sequencer (ages 5-8)
export { ActionTile, type ActionTileProps } from './ActionTile';
export { ActionPalette, type ActionPaletteProps } from './ActionPalette';
export { SequenceBar, type SequenceBarProps } from './SequenceBar';
// Event Handler (ages 9-12)
export * from '../../../lib/puzzleObject';
// State Architect (ages 13+)
export { StateJsonView, type StateJsonViewProps } from './StateJsonView';

export { projectileMotion, pendulum, springOscillator, ALL_PRESETS } from '../../../lib/physicsPresets';

// ---------------------------------------------------------------------------
// Templates (thin wrappers — header + Board organism)
// ---------------------------------------------------------------------------
export { GameShell, type GameShellProps } from '../templates/GameShell';
// Game-genre templates removed — boards are now .lolo game-shell compositions, not React components.
