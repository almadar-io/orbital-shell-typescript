'use client';
/**
 * Canvas — the unified game canvas draw-host (P6 closing).
 *
 * A single `type: canvas` host that renders authored `drawables` (the neutral
 * `draw-*` children) through the 2D painter or the 3D painter selected by `mode`.
 * Both painters consume the EXACT same `drawables`; they differ only in how a
 * `ScenePos` projects and how a sprite/shape/text is rasterized vs meshed. This
 * retires the direct use of `canvas-2d` / `game-canvas-3d` from board authoring:
 * a board writes `{ type: canvas, mode, camera, children: [...] }`.
 *
 * Camera: the neutral core `Camera` ({ mode, zoom, ... }) is mapped to each
 * host's legacy vocab here (2D `camera` string / 3D `cameraMode`; `zoom` → 2D
 * `scale` / 3D camera dolly), so the board carries one camera object regardless
 * of painter.
 *
 * Interaction: a click/hover event is one event-name string forwarded to whichever
 * painter `mode` selects. Its payload phantom is the merge of both painters' emit
 * shapes so the single value stays assignable to either host's prop (the two hosts
 * still emit their own coordinate shape at runtime).
 *
 * The 3D host (three.js/R3F) is lazy-imported so a 2D-only app never pulls the
 * 3D bundle — the code-split boundary the drawable atoms were built R3F-free for.
 *
 * @packageDocumentation
 */

import * as React from 'react';
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@almadar/logger';
import type { A11yProps, Asset, AssetUrl, Camera, EventEmit, EventKey } from '@almadar/core';
import { domPassthrough } from '../../../core';
import type { DrawableNode } from '../../../lib/drawable/paintDispatch';
import { DrawableRegistryContext, type DrawableRegistrar } from '../../../lib/drawable/registry';
import { Canvas2D, type CameraMode as Canvas2DCameraMode, type Projection } from './Canvas2D';
import type { Canvas3DHostProps, CanvasLighting, CanvasPost } from '../../../lib/drawable/three/Canvas3DHost';

/** Lazy 3D host — keeps three/R3F out of the bundle unless a 3D canvas renders: the package's one
 *  split ESM build makes this `import()` its own chunk (the `./three` entry). */
const Canvas3DHost = lazy(() =>
    import('../../../lib/drawable/three').then((m) => ({ default: m.Canvas3DHost })),
);

/** Painter selection. Same `drawables` for both; differ only in projection + rasterizer. */
export type CanvasMode = '2d' | '3d';

export interface CanvasProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
    /** Painter: 2D sprite/shape/text raster, or 3D mesh. Default '2d'. */
    mode?: CanvasMode;
    /** Neutral drawable descriptors — the `draw-*` children. Routed to the host's painter. */
    drawables?: DrawableNode[];
    /** Neutral camera pose. Mapped to the underlying host's framing + zoom. */
    camera?: Camera;
    /** 2D grid layout (2D mode only): isometric / hex / flat / free / side. */
    projection?: Projection;

    // --- Shared view config ---
    className?: string;
    isLoading?: boolean;
    /** Unit draw-size multiplier (both painters). */
    unitScale?: number;
    /** Minimap overlay (2D). */
    showMinimap?: boolean;
    /** Auto-fit the board's grid extent to the viewport (2D grid layouts; default
     *  false — boards render at their authored `camera.zoom` scale). */
    fit?: boolean;
    /** Native tile/cell width in source px of the board's asset (2D grid layouts;
     *  defaults to the detected atlas tile width, else 256). */
    tileWidth?: number;
    /** Backdrop image (2D iso/hex/flat/free/side). */
    backgroundImage?: AssetUrl | Asset;
    /** Solid backdrop colour — 2D `side` fill and 3D scene clear colour. */
    backgroundColor?: string;
    /** Side/free world bounds (2D `side`) and 3D world extent. */
    worldWidth?: number;
    worldHeight?: number;
    /** 3D world-unit → pixel scale (perspective/side depth). 3D only. */
    pixelsPerUnit?: number;
    /** 3D-only presentation. */
    showGrid?: boolean;
    shadows?: boolean;
    showCoordinates?: boolean;
    showTileInfo?: boolean;
    fogOfWar?: boolean[][];
    /** 3D scene light rig as data — ambient/directional/hemisphere/point lights + optional
     *  'room' environment for PBR reflections. Omitted → the standard fixed rig. */
    lighting?: CanvasLighting;
    /** 3D post-processing stack — bloom (emissive glow / neon) and vignette. Omitted →
     *  no post pass. */
    post?: CanvasPost;

    // --- Shared interaction (LOLO-owned). The painter emitted at runtime depends on
    //     `mode`, so the payload is genuinely mode-polymorphic: an INTERSECTION of the
    //     two painters' emit shapes. It stays assignable to either host's prop (for the
    //     dispatch below) — an all-optional single shape is NOT (verified: 6× TS2322 at
    //     the dispatch sites). pattern-sync flattens this to individually-OPTIONAL fields,
    //     because two members each contributing named fields cannot be shown to co-occur
    //     at runtime — so no trait is forced to declare both modes' fields at once. ---
    tileClickEvent?: EventEmit<{ x: number; y: number } & { tileId: string; z: number }>;
    unitClickEvent?: EventEmit<{ unitId: string } & { x: number; z: number }>;
    /** @notification */
    tileHoverEvent?: EventEmit<{ x: number; y: number } & { tileId: string; z: number }>;
    /** @notification */
    tileLeaveEvent?: EventEmit<Record<string, never>>;
    /** Feature-click event (3D only). */
    featureClickEvent?: EventEmit<{ featureId: string; x: number; z: number; type?: string; elevation?: number }>;
    /** Maps a keydown `e.code` — optionally prefixed `Mod+` (⌘/Ctrl), `Shift+`, `Alt+` in that order — to the board's SEMANTIC event (device-agnostic input), emitted as `UI:{event}`; keystrokes inside inputs/textareas never route. */
    keyMap?: Record<string, EventKey>;
    /** Maps a keyup `e.code` — optionally prefixed `Mod+` (⌘/Ctrl), `Shift+`, `Alt+` in that order — to the board's SEMANTIC event, emitted as `UI:{event}`; keystrokes inside inputs/textareas never route. */
    keyUpMap?: Record<string, EventKey>;

    // --- Scene-edit mode (a game studio selecting/dragging drawables). Purely
    //     additive; suppresses `tileClickEvent`/`unitClickEvent` while active.
    //     Coordinates are SCENE coordinates for both painters — the 3D host maps
    //     scene y ↔ world z. ---
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

    /** Declarative JSX drawable children (`<DrawShape .../>` composed in paint order).
     *  Forwarded to the 2D host, which collects them via drawable registry context. */
    children?: React.ReactNode;
}

const canvasLog = createLogger('almadar:ui:game-canvas');

/** 2D `camera` string from the neutral Camera mode: only `follow` tracks; the fixed
 *  framings (isometric/top-down) become the 2D `fixed` camera; `chase`/`perspective`
 *  (3D-native) fall back to `pan-zoom` in 2D. */
export function to2DCamera(mode: Camera['mode'], controls?: boolean): Canvas2DCameraMode {
    if (mode === 'follow') return 'follow';
    if (controls === false) return 'fixed';
    if (mode === 'isometric' || mode === 'top-down') return 'fixed';
    return 'pan-zoom';
}

/** 3D `cameraMode` maps 1:1 from the neutral Camera mode (same vocabulary). */
function to3DCameraMode(mode: Camera['mode']): Canvas3DHostProps['cameraMode'] {
    return mode ?? 'isometric';
}

export function Canvas({
    mode = '2d',
    drawables,
    camera,
    projection,
    className,
    isLoading,
    unitScale,
    showMinimap,
    fit,
    tileWidth,
    backgroundImage,
    backgroundColor,
    worldWidth,
    worldHeight,
    pixelsPerUnit,
    showGrid,
    shadows,
    showCoordinates,
    showTileInfo,
    fogOfWar,
    lighting,
    post,
    tileClickEvent,
    unitClickEvent,
    tileHoverEvent,
    tileLeaveEvent,
    featureClickEvent,
    keyMap,
    keyUpMap,
    editable,
    selectedId,
    onSelect,
    onMove,
    selectEvent,
    moveEvent,
    children,
    ...rest
}: CanvasProps): React.JSX.Element {
    canvasLog.debug('Canvas render', { mode, drawablesCount: drawables?.length, projection, camera: camera ? JSON.stringify(camera) : undefined });
    const zoom = camera?.zoom;

    // 3D-mode JSX drawable children — collected HERE (the main chunk) rather than
    // in the lazy 3D host: the three chunk bundles its own copy of `registry.ts`,
    // so a provider inside it would be a DIFFERENT context object from the one the
    // drawable atoms' `useContext` reads. Children render in a hidden DOM div
    // (React context cannot cross the R3F renderer boundary anyway), register
    // during the pass, and the commit effect adopts them into state so the host
    // re-renders with the merged `drawables`. Canvas2D keeps its own provider.
    const childDrawablesRef = useRef<DrawableNode[]>([]);
    if (mode === '3d') childDrawablesRef.current = [];
    const registerChildDrawable: DrawableRegistrar = useCallback((node) => {
        childDrawablesRef.current.push(node);
    }, []);
    const [childDrawables, setChildDrawables] = useState<DrawableNode[]>([]);
    useEffect(() => {
        if (mode !== '3d') return;
        const next = childDrawablesRef.current;
        canvasLog.debug('children:adopt', { registered: next.length, adopted: childDrawables.length });
        // A render pass where the (unchanged) children bailed out of re-rendering
        // registers nothing — that is NOT "children went empty"; keep the adopted
        // set. Only an actual unmount of the children clears it (count 0 below).
        if (next.length === 0 && React.Children.count(children) > 0) return;
        setChildDrawables((prev) =>
            prev.length === next.length && JSON.stringify(prev) === JSON.stringify(next) ? prev : [...next],
        );
    });

    if (mode === '3d') {
        const props3d: Canvas3DHostProps = {
            className,
            drawables: [...(drawables ?? []), ...childDrawables],
            isLoading,
            cameraMode: to3DCameraMode(camera?.mode),
            ...(camera?.controls === false ? { controlsEnabled: false } : {}),
            ...(zoom !== undefined ? { zoom } : {}),
            ...(camera?.fov !== undefined ? { fov: camera.fov } : {}),
            ...(camera?.azimuth !== undefined ? { azimuth: camera.azimuth } : {}),
            ...(camera?.elevation !== undefined ? { elevation: camera.elevation } : {}),
            ...(camera?.target !== undefined ? { followTarget: camera.target } : {}),
            unitScale,
            backgroundColor,
            worldWidth,
            worldHeight,
            pixelsPerUnit,
            showGrid,
            shadows,
            showCoordinates,
            showTileInfo,
            fogOfWar,
            lighting,
            post,
            tileClickEvent,
            unitClickEvent,
            tileHoverEvent,
            tileLeaveEvent,
            featureClickEvent,
            keyMap,
            keyUpMap,
        };
        return (
            <>
                <Suspense fallback={null}>
                    <Canvas3DHost {...props3d} />
                </Suspense>
                {/* Hidden mount for JSX drawable children — they render null but
                    register their descriptors via DrawableRegistryContext. */}
                {React.Children.count(children) > 0 && (
                    <DrawableRegistryContext.Provider value={registerChildDrawable}>
                        <div aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>{children}</div>
                    </DrawableRegistryContext.Provider>
                )}
            </>
        );
    }

    return (
        <Canvas2D
            {...domPassthrough(rest)}
            className={className}
            drawables={drawables}
            isLoading={isLoading}
            projection={projection}
            camera={to2DCamera(camera?.mode, camera?.controls)}
            {...(zoom !== undefined ? { scale: zoom } : {})}
            {...(fit !== undefined ? { fit } : {})}
            {...(tileWidth !== undefined ? { tileWidth } : {})}
            {...(camera?.target !== undefined ? { followTarget: camera.target } : {})}
            {...(camera?.pos !== undefined ? { cameraPos: camera.pos } : {})}
            showMinimap={showMinimap}
            backgroundImage={backgroundImage}
            {...(backgroundColor !== undefined ? { bgColor: backgroundColor } : {})}
            tileClickEvent={tileClickEvent}
            unitClickEvent={unitClickEvent}
            tileHoverEvent={tileHoverEvent}
            tileLeaveEvent={tileLeaveEvent}
            keyMap={keyMap}
            keyUpMap={keyUpMap}
            editable={editable}
            selectedId={selectedId}
            onSelect={onSelect}
            onMove={onMove}
            selectEvent={selectEvent}
            moveEvent={moveEvent}
            {...(children !== undefined ? { children } : {})}
        />
    );
}

Canvas.displayName = 'Canvas';
