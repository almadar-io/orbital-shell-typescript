'use client';
/**
 * Canvas3DHost — the thin 3D draw-host: the `canvas` host's 3D painter backend
 * (the R3F "vessel" behind the neutral drawables), the exact 3D analogue of the
 * 2D `Painter2D` seam. Reached only via the lazy `@almadar/ui/.../game/three`
 * subpath so three.js never enters a 2D bundle.
 *
 * The 3D twin of Canvas2D: the board authors a `drawables` list (the neutral
 * `draw-*` children) and this host maps each descriptor through `Drawable3D` to a
 * three.js mesh (a raw descriptor NEVER reaches `<group>{children}` — R3F throws).
 * It owns NO game data — tiles, units, features, selection, health bars and labels
 * are all `draw-*` children composed in `.lolo`, not props here. Only view state
 * (camera, error boundary) is local.
 *
 * Camera: `isometric`/`perspective`/`top-down` frame the scene bounds (derived from
 * the drawn descriptors); `follow`/`chase` track the neutral core `Camera.target`
 * (forwarded as `followTarget`), falling back to the scene centre.
 *
 * Interaction: keyboard maps to semantic events (device-agnostic input). Pointer
 * click on a tagged drawable (a descriptor carrying `DrawableBase.id`) raycasts to
 * the mesh and walks up to the tagged ancestor → `unitClickEvent {unitId,x,z}`;
 * a click that hits no tagged mesh falls back to the ground-plane cell raycast →
 * `tileClickEvent`. Pointer hover/feature events are accepted but not yet
 * emitted (docs/Almadar_Std_Gaps.md S-CANVAS3D-HOVER-DEAD).
 *
 * @packageDocumentation
 */

import React, {
    useCallback,
    useEffect,
    useRef,
    useState,
    useMemo,
    forwardRef,
    useImperativeHandle,
} from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { EventEmit, EventKey, Asset, ScenePos } from '@almadar/core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { keyMapCode, resolveKeyMapEvent } from '../../keyMapEvent';
import { collectDrawnItems, buildHitIndex, withPreviewPosition } from '../hitTest';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls, Grid } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useGameCanvas3DEvents } from './hooks/useGameCanvas3DEvents';
import { Canvas3DLoadingState } from './Canvas3DLoadingState';
import { Canvas3DErrorBoundary } from './Canvas3DErrorBoundary';
import { Lighting3D } from './Lighting3D';
import { Effects3D } from './Effects3D';
import { CameraController3D, FollowCamera3D } from './GameCamera3D';
import { Drawable3D } from './Drawable3D';
import { Shape3D } from './mesh3d';
import { BoneRegistryContext, BoneStore } from './BoneRegistry';
import { create3DProjector } from '../projector3d';
import type { DrawableNode } from '../paintDispatch';
import type { IsometricTile, IsometricUnit, IsometricFeature } from '../../isometricTypes';
import { useCanvasTheme } from '../../../hooks/useCanvasTheme';
import { useOnScreen } from '../../../hooks/useOnScreen';
import { markColor, withSeries } from '../../canvasTheme';
import { applySceneMaterials, resolveDrawableColors } from '../themeDrawables';
import { cn } from '../../../core';
import './Canvas3DHost.css';

// Re-export types for convenience
export type { IsometricTile, IsometricUnit, IsometricFeature };

/** Camera mode for 3D view.
 *  - `follow` tracks `followTarget` (the neutral `Camera.target`) from a fixed offset.
 *  - `chase` sits behind + above the target. */
export type CameraMode = 'isometric' | 'perspective' | 'top-down' | 'front' | 'follow' | 'chase';

/** Per-role model manifest (retained type export; the thin host no longer resolves
 *  models from a manifest — a `draw-sprite` carries its own `Asset`). */
export interface GameCanvas3DAssetManifest {
    terrains?: Record<string, Asset>;
    units?: Record<string, Asset>;
    features?: Record<string, Asset>;
    effects?: Record<string, Asset>;
}

/** Map orientation */
export type MapOrientation = 'standard' | 'rotated';

/** Overlay control */
export type OverlayControl = 'default' | 'hidden' | 'minimap';

/** Single light's tunable knobs (ambient/directional share this shape). */
export interface CanvasLightConfig {
    intensity?: number;
    color?: string;
    position?: [number, number, number];
}

/** Hemisphere (sky/ground) light config. */
export interface CanvasHemisphereConfig {
    intensity?: number;
    color?: string;
    groundColor?: string;
}

/** Point light config — `position` is required since a point light has no
 *  meaningful default placement. */
export interface CanvasPointLightConfig {
    intensity?: number;
    color?: string;
    position: [number, number, number];
    distance?: number;
    decay?: number;
}

/** Canvas-level 3D light rig, authored as data. Every field is optional — an
 *  omitted field falls back to today's fixed rig (the defaults live in `Lighting3D`). */
export interface CanvasLighting {
    /** Default intensity 0.6, color '#ffffff'. */
    ambient?: CanvasLightConfig;
    /** Default intensity 0.8, color '#ffffff', position [10, 20, 10]. */
    directional?: CanvasLightConfig;
    /** Default intensity 0.3, color '#87ceeb', groundColor '#362d1d'. */
    hemisphere?: CanvasHemisphereConfig;
    /** Additional point lights. Default none. */
    points?: CanvasPointLightConfig[];
    /** Procedural environment for PBR reflection (metals/glass). 'room' uses three's
     *  RoomEnvironment via PMREMGenerator — no network fetch. Default 'none' (today's
     *  look). */
    environment?: 'room' | 'none';
    /** Output tone mapping. Default 'aces' (R3F's filmic default — the stylized look
     *  every existing scene was authored under); 'none' renders material colors
     *  faithfully (raw three default — what GLB viewers show). */
    toneMapping?: 'aces' | 'none';
}

/** Canvas-level post-processing stack. Every field is optional — an omitted field
 *  means that pass is not mounted. */
export interface CanvasPost {
    bloom?: { intensity?: number; threshold?: number; smoothing?: number };
    vignette?: { offset?: number; darkness?: number };
}

/** Props for GameCanvas3D component */
export interface Canvas3DHostProps {
    // --- Closed-circuit ---
    /** Additional CSS classes */
    className?: string;
    /** Declarative JSX drawable children — rendered in a hidden DOM mount where they
     *  register their descriptors via DrawableRegistryContext (same contract as Canvas2D). */
    children?: React.ReactNode;
    /** Neutral drawable descriptors — the same `children` vocabulary as Canvas2D. The
     *  host maps each through `Drawable3D` to a mesh. */
    drawables?: DrawableNode[];
    /** Loading state indicator */
    isLoading?: boolean;
    /** Error state */
    error?: string | null;
    /** Fog of war data (accepted for API parity; presentation-only). */
    fogOfWar?: boolean[][];
    /** Map orientation (data attribute). */
    orientation?: MapOrientation;
    /** Camera mode */
    cameraMode?: CameraMode;
    /** Follow-camera target in scene space (the neutral core `Camera.target`). */
    followTarget?: ScenePos;
    /** Show grid */
    showGrid?: boolean;
    /** Show coordinates overlay (accepted for API parity). */
    showCoordinates?: boolean;
    /** Show tile information (accepted for API parity). */
    showTileInfo?: boolean;
    /** Overlay control mode (data attribute). */
    overlay?: OverlayControl;
    /** Enable shadows */
    shadows?: boolean;
    /** Background color */
    /** Overrides the theme's categorical palette (`series-1…N`) for this scene. */
    series?: string[];
    backgroundColor?: string;
    /** Declarative event: tile click. Emitted from a ground-plane raycast → scene cell
     *  `{ x, z }` (the FSM validates the cell). `tileId` is optional — the neutral host
     *  has no per-tile id, and the board FSMs key off the coordinate. */
    tileClickEvent?: EventEmit<{ x: number; z: number; tileId?: string; type?: string; terrain?: string; elevation?: number }>;
    /** Declarative event: unit click. Emitted `{ unitId, x, z }` when the raycast hits a
     *  mesh tagged with a descriptor `id` (or lands on a ground cell whose descriptor
     *  carries an `id`). */
    unitClickEvent?: EventEmit<{ unitId: string; x: number; z: number; unitType?: string; name?: string; team?: string; faction?: string; health?: number; maxHealth?: number }>;
    /** Declarative event: feature click. Accepted; not yet emitted (see `tileClickEvent`). */
    featureClickEvent?: EventEmit<{ featureId: string; x: number; z: number; type?: string; elevation?: number }>;
    /** Declarative event: canvas (background) click. */
    canvasClickEvent?: EventEmit<{ clientX: number; clientY: number; button: number }>;
    /** Declarative event: tile hover. Accepted; not yet emitted (see `tileClickEvent`). */
    tileHoverEvent?: EventEmit<{ tileId: string; x: number; z: number; type?: string }>;
    /** Declarative event: tile leave. */
    tileLeaveEvent?: EventEmit<Record<string, never>>;
    /** Declarative event: unit animation. */
    unitAnimationEvent?: EventEmit<{ unitId: string; state: string; timestamp: number }>;
    /** Declarative event: camera change. */
    cameraChangeEvent?: EventEmit<{ position: { x: number; y: number; z: number }; timestamp: number }>;
    /** Loading message */
    loadingMessage?: string;
    /** Unit draw-size multiplier (accepted for API parity; sizing is drawable-authored). */
    unitScale?: number;
    /** Board zoom — the neutral `Camera.zoom`. Dollies the camera: the framing
     *  distance is divided by `zoom` (undefined/1 = default framing; <= 0 ignored). */
    zoom?: number;
    /** Enable the orbit camera controls. Default true; `follow`/`chase` modes always
     *  disable them (the follow camera is authoritative). */
    controlsEnabled?: boolean;
    /** Maps a keydown `e.code` — optionally prefixed `Mod+` (⌘/Ctrl), `Shift+`, `Alt+` in that order — to the board's SEMANTIC event (device-agnostic input), emitted as `UI:{event}`; keystrokes inside inputs/textareas never route. */
    keyMap?: Record<string, EventKey>;
    /** Maps a keyup `e.code` — optionally prefixed `Mod+` (⌘/Ctrl), `Shift+`, `Alt+` in that order — to the board's SEMANTIC event, emitted as `UI:{event}`; keystrokes inside inputs/textareas never route. */
    keyUpMap?: Record<string, EventKey>;
    /** Side-view world size in pixels (accepted for API parity). */
    worldWidth?: number;
    /** Side-view world size in pixels (accepted for API parity). */
    worldHeight?: number;
    /** Pixel→world-unit divisor for pixel-authored (side-view) scenes: world size =
     *  scene size ÷ `pixelsPerUnit`. Omitted → 1 world unit per scene unit (grid boards). */
    pixelsPerUnit?: number;
    /** Perspective field of view in degrees — the neutral `Camera.fov`. Default 45. */
    fov?: number;
    /** Orbit the mode's framing position around the vertical axis through the target, in radians — the neutral `Camera.azimuth`. */
    azimuth?: number;
    /** Orbit height angle above the ground plane, in radians — the neutral `Camera.elevation`
     *  (perspective mode). Omitted → the mode's fixed framing height. */
    elevation?: number;
    /** 3D scene light rig as data — ambient/directional/hemisphere/point lights + optional
     *  'room' environment. Omitted → the standard fixed rig (this host's current
     *  hardcoded lights, unchanged). */
    lighting?: CanvasLighting;
    /** 3D post-processing stack — bloom + vignette. Omitted → no composer pass mounted. */
    post?: CanvasPost;

    // --- Scene-edit mode (a game studio selecting/dragging drawables). Purely
    //     additive; suppresses `tileClickEvent`/`unitClickEvent` and the orbit
    //     controls while active. Coordinates are SCENE coordinates — the same
    //     `{x,z}` space `tileClickEvent` emits — the host maps scene y ↔ world z. ---
    /** Enter scene-edit mode: click selects/deselects a drawable, drag moves it. */
    editable?: boolean;
    /** The currently-selected drawable id (controlled); `null`/undefined = none. */
    selectedId?: string | null;
    /** Fired on a click that changes selection — before `selectEvent`. */
    onSelect?: (id: string | null) => void;
    /** Fired once per drag gesture, on drop — before `moveEvent`. */
    onMove?: (id: string, x: number, y: number) => void;
    /** Declarative selection event, `UI:{selectEvent} { id }`. */
    selectEvent?: EventEmit<{ id: string | null }>;
    /** Declarative move event, `UI:{moveEvent} { id, x, y }` — fired once on drop. */
    moveEvent?: EventEmit<{ id: string; x: number; y: number }>;
}

/** Grid configuration */
interface GridConfig {
    cellSize: number;
    offsetX: number;
    offsetZ: number;
}

/** Default grid config */
const DEFAULT_GRID_CONFIG: GridConfig = {
    cellSize: 1,
    offsetX: 0,
    offsetZ: 0,
};

/** Edit-mode selection ring color + ground radius (world units), matching the
 *  2D host's selection overlay color. */
const EDIT_SELECTION_RADIUS = 0.6;

/** One in-flight edit-mode drag gesture (a single pointer). */
interface EditDragState3D {
    id: string;
    startClientX: number;
    startClientY: number;
    moved: boolean;
}

/** Imperative handle for GameCanvas3D */
export interface Canvas3DHostHandle {
    /** Get current camera position */
    getCameraPosition: () => THREE.Vector3 | null;
    /** Set camera position */
    setCameraPosition: (x: number, y: number, z: number) => void;
    /** Look at a specific point */
    lookAt: (x: number, y: number, z: number) => void;
    /** Reset camera to default position */
    resetCamera: () => void;
    /** Take a screenshot */
    screenshot: () => string | null;
}

/**
 * CameraPose — re-applies the mode/azimuth framing whenever it changes. R3F's
 * Canvas `camera` prop is creation-time only, so a runtime camera switch (a
 * board changing `camera.mode`, spritesheet baking orbiting `Camera.azimuth`
 * per CELL) must set the pose imperatively; `controls.update()` then re-aims
 * at the OrbitControls target from the new position.
 */
function CameraPose({
    position,
    fov,
    controls,
}: {
    position: [number, number, number];
    fov: number;
    controls: React.RefObject<OrbitControlsImpl | null>;
}): null {
    const camera = useThree((s) => s.camera);
    const [px, py, pz] = position;
    // Scalar deps: the framing chain rebuilds `position`'s identity every tick,
    // and re-posing on identity alone fights OrbitControls/FollowCamera3D.
    useEffect(() => {
        camera.position.set(px, py, pz);
        if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
            (camera as THREE.PerspectiveCamera).fov = fov;
            (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
        }
        controls.current?.update();
    }, [camera, px, py, pz, fov, controls]);
    return null;
}

/**
 * RoomEnvironment3D — mounts three's `RoomEnvironment` through a `PMREMGenerator` so
 * PBR surfaces (metals/glass) pick up a procedural reflection with no network fetch.
 * Disposes the generated texture and restores `scene.environment` to null on unmount.
 */
function RoomEnvironment3D(): null {
    const { gl, scene } = useThree(({ gl, scene }) => ({ gl, scene }));

    useEffect(() => {
        const pmremGenerator = new THREE.PMREMGenerator(gl);
        const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environment = envTexture;
        return () => {
            scene.environment = null;
            envTexture.dispose();
            pmremGenerator.dispose();
        };
    }, [gl, scene]);

    return null;
}

/**
 * Canvas3DHost — thin 3D draw-host. Walks `drawables` through `Drawable3D`.
 */
export const Canvas3DHost = forwardRef<Canvas3DHostHandle, Canvas3DHostProps>(
    (
        {
            cameraMode = 'isometric',
            followTarget,
            showGrid = true,
            orientation = 'standard',
            overlay = 'default',
            shadows = true,
            backgroundColor,
            series,
            className,
            isLoading: externalLoading,
            error: externalError,
            tileClickEvent,
            unitClickEvent,
            featureClickEvent,
            canvasClickEvent,
            tileHoverEvent,
            tileLeaveEvent,
            unitAnimationEvent,
            cameraChangeEvent,
            loadingMessage: loadingMessageProp,
            keyMap,
            keyUpMap,
            pixelsPerUnit,
            fov,
            azimuth,
            elevation,
            zoom,
            controlsEnabled = true,
            lighting,
            post,
            children,
            drawables,
            editable = false,
            selectedId = null,
            onSelect,
            onMove,
            selectEvent,
            moveEvent,
        },
        ref
    ) => {
        const containerRef = useRef<HTMLDivElement>(null);
        // Off screen or in a hidden tab the scene stops rendering frames.
        const onScreen = useOnScreen(containerRef);
        const controlsRef = useRef<OrbitControlsImpl | null>(null);
        const [internalError, setInternalError] = useState<string | null>(null);
        const eventBus = useEventBus();
        const { t } = useTranslate();
        const loadingMessage = loadingMessageProp ?? t('canvas3d.loadingScene');
        const keysRef = useRef<Set<string>>(new Set());

        // JSX drawable children are collected by the UNIFIED Canvas (main chunk) and
        // arrive pre-merged in `drawables`: a DrawableRegistryContext provider in this
        // lazy chunk would be a different module instance from the one the drawable
        // atoms read, so registration must happen outside the three bundle.
        const { theme: baseCanvasTheme } = useCanvasTheme(containerRef);
        const seriesKey = series ? series.join('|') : '';
        const canvasTheme = useMemo(() => withSeries(baseCanvasTheme, series, containerRef.current), [baseCanvasTheme, seriesKey]);
        // Tones and var() colors resolve once here; meshes take the theme's material response.
        const allDrawables = useMemo(() => {
            const raw = drawables ?? [];
            const scope = containerRef.current;
            if (!canvasTheme || !scope) return raw;
            const resolved = resolveDrawableColors(raw, (c) => markColor(canvasTheme, c, scope, 'ink'));
            return applySceneMaterials(resolved, canvasTheme);
        }, [drawables, canvasTheme]);
        const ground = backgroundColor ?? canvasTheme?.ground ?? 'transparent';
        const selectionColor = canvasTheme?.tones.highlight ?? 'currentColor';

        // Keyboard → the board's SEMANTIC events via the declarative keyMap/keyUpMap.
        // The input layer only translates device keycodes; the FSM stays device-agnostic.
        useEffect(() => {
            if (!keyMap && !keyUpMap) return;
            const down = (e: KeyboardEvent): void => {
                const code = keyMapCode(e);
                if (keysRef.current.has(code)) return;
                keysRef.current.add(code);
                const ev = resolveKeyMapEvent(keyMap, e);
                if (ev) {
                    eventBus.emit(`UI:${ev}`, {});
                    e.preventDefault();
                }
            };
            const up = (e: KeyboardEvent): void => {
                keysRef.current.delete(keyMapCode(e));
                const ev = resolveKeyMapEvent(keyUpMap, e);
                if (ev) eventBus.emit(`UI:${ev}`, {});
            };
            window.addEventListener('keydown', down);
            window.addEventListener('keyup', up);
            return () => {
                window.removeEventListener('keydown', down);
                window.removeEventListener('keyup', up);
            };
        }, [keyMap, keyUpMap, eventBus]);

        // Event handlers (canvas/background click + camera change use these; tile/unit
        // clicks are emitted by handleDrawableClick/handleGroundClick below).
        const eventHandlers = useGameCanvas3DEvents({
            tileClickEvent,
            unitClickEvent,
            featureClickEvent,
            canvasClickEvent,
            tileHoverEvent,
            tileLeaveEvent,
            unitAnimationEvent,
            cameraChangeEvent,
        });

        // Scene bounds + click hit-index derived from the drawn descriptors (no tile data prop).
        const drawnItems = useMemo(() => collectDrawnItems(allDrawables), [allDrawables]);
        const scenePositions = useMemo(() => drawnItems.map((i) => i.pos), [drawnItems]);
        const hitIndex = useMemo(() => buildHitIndex(drawnItems), [drawnItems]);
        const gridBounds = useMemo(() => {
            if (scenePositions.length === 0) {
                return { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
            }
            let minX = Infinity;
            let maxX = -Infinity;
            let minZ = Infinity;
            let maxZ = -Infinity;
            for (const p of scenePositions) {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minZ) minZ = p.y;
                if (p.y > maxZ) maxZ = p.y;
            }
            return { minX, maxX, minZ, maxZ };
        }, [scenePositions]);

        // World units per scene unit: 1 for grid-authored scenes; pixel-authored
        // (side-view) scenes are divided down by `pixelsPerUnit` so framing distances,
        // follow offsets and the far clip plane stay in their calibrated ranges.
        const cellSize =
            pixelsPerUnit !== undefined && pixelsPerUnit > 0
                ? 1 / pixelsPerUnit
                : DEFAULT_GRID_CONFIG.cellSize;

        // Camera target (centre of the scene bounds, in world space — the projector
        // anchors world X/Z on the bounds' min, so the centre is the half-extent).
        const cameraTarget = useMemo(
            () =>
                [
                    ((gridBounds.maxX - gridBounds.minX) / 2) * cellSize,
                    0,
                    ((gridBounds.maxZ - gridBounds.minZ) / 2) * cellSize,
                ] as [number, number, number],
            [gridBounds, cellSize]
        );

        const gridConfig = useMemo(
            () => ({
                cellSize,
                offsetX: -(gridBounds.maxX - gridBounds.minX) / 2,
                offsetZ: -(gridBounds.maxZ - gridBounds.minZ) / 2,
            }),
            [gridBounds, cellSize]
        );

        const boneStore = useMemo(() => new BoneStore(), []);

        // Neutral projector for drawable descriptors — anchors on the scene bounds so
        // a drawable at scene `{x, y}` lands at world `((x-minX)·cell, (y-minZ)·cell)`.
        const drawableProjector = useMemo(
            () =>
                create3DProjector({
                    cellSize: gridConfig.cellSize,
                    offsetX: -gridBounds.minX * gridConfig.cellSize,
                    offsetZ: -gridBounds.minZ * gridConfig.cellSize,
                }),
            [gridBounds, gridConfig]
        );

        // -- Scene-edit mode: a single in-flight drag gesture + its live preview. --
        const editDragRef = useRef<EditDragState3D | null>(null);
        const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);

        /** Ground-plane raycast hit → SCENE cell (the drawable projector's inverse),
         *  shared by the tile-click resolve and the edit-mode drag preview. */
        const groundPointToScene = useCallback((point: THREE.Vector3): { x: number; y: number } => ({
            x: Math.round(point.x / gridConfig.cellSize + gridBounds.minX),
            y: Math.round(point.z / gridConfig.cellSize + gridBounds.minZ),
        }), [gridConfig, gridBounds]);

        // Drawables actually rendered: the authored graph, or — mid-drag — a clone
        // with the dragged node's position swapped to its live preview cell (never
        // a mesh/painter API change, just a data substitution before the walk).
        const paintDrawables = useMemo(
            () => (dragPreview ? withPreviewPosition(allDrawables, dragPreview.id, { x: dragPreview.x, y: dragPreview.y }) : allDrawables),
            [allDrawables, dragPreview],
        );

        // Selection ring position: the selected item's authored position, or its
        // live drag preview while it is the one being dragged.
        const selectedItem = useMemo(
            () => (editable && selectedId != null ? drawnItems.find((it) => it.id === selectedId) : undefined),
            [editable, selectedId, drawnItems],
        );
        const selectionPos = useMemo(() => {
            if (!selectedItem) return undefined;
            if (dragPreview && dragPreview.id === selectedItem.id) return { x: dragPreview.x, y: dragPreview.y };
            return selectedItem.pos;
        }, [selectedItem, dragPreview]);

        // Imperative handle (camera control + screenshot only).
        useImperativeHandle(ref, () => ({
            getCameraPosition: () => {
                if (controlsRef.current) {
                    const pos = controlsRef.current.object.position;
                    return new THREE.Vector3(pos.x, pos.y, pos.z);
                }
                return null;
            },
            setCameraPosition: (x: number, y: number, z: number) => {
                if (controlsRef.current) {
                    controlsRef.current.object.position.set(x, y, z);
                    controlsRef.current.update();
                }
            },
            lookAt: (x: number, y: number, z: number) => {
                if (controlsRef.current) {
                    controlsRef.current.target.set(x, y, z);
                    controlsRef.current.update();
                }
            },
            resetCamera: () => {
                if (controlsRef.current) {
                    controlsRef.current.reset();
                }
            },
            screenshot: () => {
                const canvas = containerRef.current?.querySelector('canvas');
                if (canvas) {
                    return canvas.toDataURL('image/png');
                }
                return null;
            },
        }));

        // Camera configuration based on mode. Framing size is in WORLD units (the
        // scene extent × cellSize) so pixel-authored worlds stay inside the far plane.
        const cameraConfig = useMemo(() => {
            const size = Math.max(
                (gridBounds.maxX - gridBounds.minX) * cellSize,
                (gridBounds.maxZ - gridBounds.minZ) * cellSize,
                4  // minimum framing distance so a tiny board isn't zoomed in
            );
            const cx = cameraTarget[0];
            const cz = cameraTarget[2];
            // Neutral `Camera.zoom` dollies the framing distance (<= 0 is no zoom).
            const d = (size * 1.0) / (zoom !== undefined && zoom > 0 ? zoom : 1);
            const fovDeg = fov ?? 45;

            const base = ((): { position: [number, number, number]; fov: number } => {
                switch (cameraMode) {
                    case 'isometric':
                        return { position: [cx + d, d * 0.8, cz + d], fov: fovDeg };
                    case 'top-down':
                        // A small forward tilt avoids the OrbitControls gimbal lock at exactly-overhead.
                        return { position: [cx, d * 2, cz + d * 0.35], fov: fovDeg };
                    case 'front':
                        // Straight-on "flat" elevation from +Z (scene +y — the side rigs face):
                        // the side-scroller/reference-sheet view; near-zero elevation keeps
                        // vertical proportions unforeshortened.
                        return { position: [cx, d * 0.32, cz + d * 1.15], fov: fovDeg };
                    case 'follow':
                        return { position: [cx, d * 0.5, cz + d], fov: fovDeg };
                    case 'perspective':
                    default: {
                        if (elevation === undefined) return { position: [cx + d, d, cz + d], fov: fovDeg };
                        // Neutral `Camera.elevation`: height angle above the ground plane
                        // (clamped below gimbal-lock overhead); horizontal radius stays d.
                        const el = Math.min(Math.max(elevation, 0), Math.PI / 2 - 0.1);
                        return { position: [cx + d, d * Math.tan(el), cz + d], fov: fovDeg };
                    }
                }
            })();
            if (!azimuth) return base;
            // Neutral `Camera.azimuth`: orbit the framing position around the
            // vertical axis through the target (spritesheet baking turns the view,
            // not the model — the posed cells stay identical across facings).
            const ox = base.position[0] - cx;
            const oz = base.position[2] - cz;
            const c = Math.cos(azimuth);
            const s = Math.sin(azimuth);
            return { position: [cx + ox * c - oz * s, base.position[1], cz + ox * s + oz * c] as [number, number, number], fov: base.fov };
        }, [cameraMode, gridBounds, cellSize, cameraTarget, fov, azimuth, elevation, zoom]);

        // Follow target in world space — the neutral `Camera.target`, else scene centre.
        const followWorld = useMemo((): [number, number, number] => {
            if (followTarget) return drawableProjector.toWorld(followTarget);
            return cameraTarget;
        }, [followTarget, drawableProjector, cameraTarget]);

        // Follow offset from the target (fixed per mode; no per-entity heading in the
        // thin host — a `chase` heading would ride the neutral Camera in a later pass).
        // `follow` is the side-view tracking camera: high + far enough that a 400px-deep
        // (12.5-unit) pixel-authored world fits the 45° fov without foreground occlusion.
        const followOffset = useMemo(
            (): [number, number, number] => (cameraMode === 'chase' ? [0, 4, -7] : [0, 12, 14]),
            [cameraMode]
        );

        // Ground-plane raycast → scene cell (the drawable projector's inverse) → id
        // hit-test. A cell with a tagged descriptor (a unit) → unitClick {unitId,x,z};
        // else tileClick {x,z}. The board FSM validates the cell.
        const handleGroundClick = useCallback((e: ThreeEvent<MouseEvent>) => {
            if (!tileClickEvent && !unitClickEvent) return;
            e.stopPropagation();
            const cell = groundPointToScene(e.point);
            const hitId = hitIndex.get(`${cell.x},${cell.y}`);
            if (hitId !== undefined && unitClickEvent) {
                eventBus.emit(`UI:${unitClickEvent}`, { unitId: hitId, x: cell.x, z: cell.y });
            } else if (tileClickEvent) {
                eventBus.emit(`UI:${tileClickEvent}`, { x: cell.x, z: cell.y });
            }
        }, [tileClickEvent, unitClickEvent, groundPointToScene, hitIndex, eventBus]);

        // True per-mesh picking: the raycast hit walks up to the nearest ancestor
        // tagged with a descriptor id (Drawable3D stamps `userData.drawableId`) →
        // unitClick {unitId,x,z}. stopPropagation keeps the ground fallback from
        // also firing; an untagged hit falls through to handleGroundClick.
        const handleDrawableClick = useCallback((e: ThreeEvent<MouseEvent>) => {
            if (!unitClickEvent) return;
            let obj: THREE.Object3D | null = e.object;
            while (obj) {
                const id: string | undefined = obj.userData.drawableId;
                if (id !== undefined) {
                    e.stopPropagation();
                    eventBus.emit(`UI:${unitClickEvent}`, {
                        unitId: id,
                        x: e.point.x / gridConfig.cellSize + gridBounds.minX,
                        z: e.point.z / gridConfig.cellSize + gridBounds.minZ,
                    });
                    return;
                }
                obj = obj.parent;
            }
        }, [unitClickEvent, gridConfig, gridBounds, eventBus]);

        // Edit-mode pointer-down on a tagged drawable: start a drag (nearest tagged
        // ancestor, same walk as `handleDrawableClick`). stopPropagation keeps the
        // ground plane from also starting a background deselect for this gesture.
        const handleEditDrawablePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
            if (!editable) return;
            let obj: THREE.Object3D | null = e.object;
            while (obj) {
                const id: string | undefined = obj.userData.drawableId;
                if (id !== undefined) {
                    e.stopPropagation();
                    editDragRef.current = {
                        id,
                        startClientX: e.nativeEvent.clientX,
                        startClientY: e.nativeEvent.clientY,
                        moved: false,
                    };
                    return;
                }
                obj = obj.parent;
            }
        }, [editable]);

        // Edit-mode ground-plane raycast while a drag is in flight: the same 5px
        // client-distance gate `useCamera.dragDistance()` uses for pan-vs-click,
        // so a drawable pointer-down that never moves stays a click (select), not
        // a spurious move to the same cell.
        const handleEditGroundPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
            const drag = editDragRef.current;
            if (!editable || !drag) return;
            const dx = e.nativeEvent.clientX - drag.startClientX;
            const dy = e.nativeEvent.clientY - drag.startClientY;
            if (!drag.moved && Math.abs(dx) + Math.abs(dy) <= 5) return;
            drag.moved = true;
            const cell = groundPointToScene(e.point);
            setDragPreview({ id: drag.id, x: cell.x, y: cell.y });
        }, [editable, groundPointToScene]);

        // Edit-mode drop: DOM-level (not a mesh raycast target) so it fires
        // regardless of what is under the cursor on release. No drag state (the
        // pointer-down hit no tagged drawable) → background click → deselect;
        // a drag that moved → `onMove`/`moveEvent` once; otherwise → toggle select.
        const handleEditPointerUp = useCallback((_e: React.PointerEvent<HTMLDivElement>) => {
            if (!editable) return;
            const drag = editDragRef.current;
            editDragRef.current = null;
            if (!drag) {
                onSelect?.(null);
                if (selectEvent) eventBus.emit(`UI:${selectEvent}`, { id: null });
                return;
            }
            if (drag.moved) {
                setDragPreview((preview) => {
                    if (preview && preview.id === drag.id) {
                        onMove?.(drag.id, preview.x, preview.y);
                        if (moveEvent) eventBus.emit(`UI:${moveEvent}`, { id: drag.id, x: preview.x, y: preview.y });
                    }
                    return null;
                });
                return;
            }
            const next = selectedId === drag.id ? null : drag.id;
            onSelect?.(next);
            if (selectEvent) eventBus.emit(`UI:${selectEvent}`, { id: next });
        }, [editable, selectedId, onMove, moveEvent, onSelect, selectEvent, eventBus]);

        // Loading state.
        if (externalLoading) {
            return (
                <Canvas3DLoadingState
                    progress={1}
                    loaded={1}
                    total={1}
                    message={loadingMessage}
                    className={className}
                />
            );
        }

        // Error state.
        const displayError = externalError || internalError;
        if (displayError) {
            return (
                <Canvas3DErrorBoundary>
                    <div className="game-canvas-3d game-canvas-3d--error">
                        <div className="game-canvas-3d__error">{t('canvas3d.errorWithMessage', { message: displayError })}</div>
                    </div>
                </Canvas3DErrorBoundary>
            );
        }

        return (
            <Canvas3DErrorBoundary
                onError={(err) => setInternalError(err.message)}
                onReset={() => setInternalError(null)}
            >
                <div
                    ref={containerRef}
                    className={cn('game-canvas-3d relative w-full overflow-hidden', className)}
                    style={{ flex: '1 1 0', minHeight: '400px' }}
                    data-orientation={orientation}
                    data-camera-mode={cameraMode}
                    data-overlay={overlay}
                >
                    <Canvas
                        frameloop={onScreen ? 'always' : 'never'}
                        shadows={shadows}
                        flat={lighting?.toneMapping === 'none'}
                        // Keeps the GL buffer readable after present, so the imperative
                        // `screenshot` handle and headless `toDataURL` captures (spritesheet
                        // baking reads the buffer WITH alpha) are reliable, not driver luck.
                        gl={{ preserveDrawingBuffer: true }}
                        camera={{
                            position: cameraConfig.position,
                            fov: cameraConfig.fov,
                            near: 0.1,
                            far: 1000,
                        }}
                        style={{ background: ground, position: 'absolute', inset: 0 }}
                        onClick={(e) => {
                            if (e.target === e.currentTarget) {
                                eventHandlers.handleCanvasClick(e);
                            }
                        }}
                        onPointerUp={handleEditPointerUp}
                    >
                        <CameraController3D onCameraChange={eventHandlers.handleCameraChange} />
                        {cameraMode !== 'follow' && cameraMode !== 'chase' && (
                            <CameraPose position={cameraConfig.position} fov={cameraConfig.fov} controls={controlsRef} />
                        )}
                        {(cameraMode === 'follow' || cameraMode === 'chase') && (
                            <FollowCamera3D target={followWorld} offset={followOffset} />
                        )}

                        <Lighting3D
                            shadows={shadows}
                            shadowBias={-0.0004}
                            shadowNormalBias={0.04}
                            shadowCameraSize={5}
                            shadowCameraNear={0.5}
                            shadowCameraFar={500}
                            ambientIntensity={lighting?.ambient?.intensity ?? canvasTheme?.scene.ambient}
                            ambientColor={lighting?.ambient?.color}
                            directionalIntensity={lighting?.directional?.intensity ?? canvasTheme?.scene.key}
                            directionalColor={lighting?.directional?.color ?? canvasTheme?.scene.keyColor}
                            directionalPosition={lighting?.directional?.position}
                            hemisphereIntensity={lighting?.hemisphere?.intensity}
                            hemisphereColor={lighting?.hemisphere?.color}
                            hemisphereGroundColor={lighting?.hemisphere?.groundColor}
                            points={lighting?.points}
                        />

                        {lighting?.environment === 'room' && <RoomEnvironment3D />}

                        {showGrid && (
                            <Grid
                                args={[
                                    Math.max((gridBounds.maxX - gridBounds.minX + 2) * cellSize, 10),
                                    Math.max((gridBounds.maxZ - gridBounds.minZ + 2) * cellSize, 10),
                                ]}
                                position={[
                                    ((gridBounds.maxX - gridBounds.minX) / 2) * cellSize - cellSize / 2,
                                    0,
                                    ((gridBounds.maxZ - gridBounds.minZ) / 2) * cellSize - cellSize / 2,
                                ]}
                                cellSize={1}
                                cellThickness={1}
                                cellColor={canvasTheme?.tones.grid ?? 'currentColor'}
                                sectionSize={5}
                                sectionThickness={1.5}
                                sectionColor={canvasTheme?.tones.axis ?? 'currentColor'}
                                fadeDistance={50}
                                fadeStrength={1}
                            />
                        )}

                        {/* Neutral drawable scene — the draw-host walk. Each descriptor is
                            mapped through Drawable3D to a mesh; raw descriptors never reach
                            `<group>{children}` (R3F throws). Same `children` vocabulary as
                            Canvas2D — this is what makes the two hosts one interface. */}
                        {allDrawables.length > 0 && (
                            <BoneRegistryContext.Provider value={boneStore}>
                                <group
                                    onClick={!editable && unitClickEvent ? handleDrawableClick : undefined}
                                    onPointerDown={editable ? handleEditDrawablePointerDown : undefined}
                                >
                                    {paintDrawables.map((node, i) => (
                                        <Drawable3D key={i} node={node} projector={drawableProjector} />
                                    ))}
                                </group>
                            </BoneRegistryContext.Provider>
                        )}

                        {/* Edit-mode selection ring — the existing 3D shape backend
                            (a stroked ellipse renders a flat ground ring), not a new
                            paint primitive. */}
                        {selectionPos && (
                            <Shape3D
                                node={{
                                    type: 'draw-shape',
                                    shape: 'ellipse',
                                    position: selectionPos,
                                    radiusX: EDIT_SELECTION_RADIUS,
                                    stroke: selectionColor,
                                }}
                                projector={drawableProjector}
                            />
                        )}

                        {/* Invisible ground plane for click hit-testing: a raycast lands
                            on the plane cell, resolved to a scene coord + id. Also the
                            edit-mode drag surface (`onPointerMove`) and background-click
                            deselect target when nothing else consumes the pointer-down. */}
                        {(tileClickEvent || unitClickEvent || editable) && (
                            <mesh
                                rotation={[-Math.PI / 2, 0, 0]}
                                position={[
                                    ((gridBounds.maxX - gridBounds.minX) / 2) * cellSize,
                                    0,
                                    ((gridBounds.maxZ - gridBounds.minZ) / 2) * cellSize,
                                ]}
                                onClick={!editable ? handleGroundClick : undefined}
                                onPointerMove={editable ? handleEditGroundPointerMove : undefined}
                            >
                                <planeGeometry
                                    args={[
                                        (gridBounds.maxX - gridBounds.minX + 4) * cellSize,
                                        (gridBounds.maxZ - gridBounds.minZ + 4) * cellSize,
                                    ]}
                                />
                                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                            </mesh>
                        )}

                        {post && (post.bloom || post.vignette) ? <Effects3D post={post} /> : null}

                        {/* Camera controls — disabled while FollowCamera3D is authoritative,
                            or while edit mode owns pointer gestures for select/drag. */}
                        <OrbitControls
                            ref={controlsRef}
                            enabled={controlsEnabled && !editable && cameraMode !== 'follow' && cameraMode !== 'chase'}
                            target={cameraTarget}
                            enableDamping
                            dampingFactor={0.05}
                            enableZoom
                            enablePan
                            touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
                            minDistance={2}
                            maxDistance={100}
                            maxPolarAngle={Math.PI / 2 - 0.1}
                        />
                    </Canvas>
                </div>
            </Canvas3DErrorBoundary>
        );
    }
);

Canvas3DHost.displayName = 'Canvas3DHost';

export default Canvas3DHost;
