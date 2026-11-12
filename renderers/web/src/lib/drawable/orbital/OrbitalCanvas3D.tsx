'use client';
/**
 * OrbitalCanvas3D — a `canvas` with `mode:"3d"` drawn by orbital-canvas (wasm) on the device the page's GpuHost
 * shares. The host only reads its own surroundings (the theme's CSS, the element size, pointer and keyboard input)
 * and emits the scene's declared events; mapping, drawing, the orbit camera and picking are orbital-canvas's.
 *
 * @packageDocumentation
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '@almadar/logger';
import type { EventKey, PatternConfig } from '@almadar/core';
import type { KernelCanvas3D } from '@almadar/shell-runtime/kernel/wire';
import { useEventBus, cn, useTranslate } from '../../../core';
import { usePrefersReducedMotion } from '../../../core/hooks/usePrefersReducedMotion';
import { useCanvasTheme } from '../../../hooks/useCanvasTheme';
import { useKernelEngine } from '../../../providers/KernelEngineContext';
import { markColor, withSeries } from '../../canvasTheme';
import type { CanvasTheme } from '@almadar/core';
import { resolveDrawableColors } from '../themeDrawables';
import type { DrawableNode } from '../paintDispatch';
import { keyMapCode, resolveKeyMapEvent } from '../../keyMapEvent';
import { createWheelGesture, mapsSwipe, mapsWheel, swipeGesture, wheelPixels } from '../../gestureMapEvent';
import './OrbitalCanvas3D.css';

/** The patterns orbital-canvas draws in 3D. */
export type Pattern3D = 'canvas' | 'physics-canvas' | 'biology-canvas' | 'chemistry-canvas';

export interface OrbitalCanvas3DProps<P extends Pattern3D> {
    pattern: P;
    /** The render node's props as the pattern declares them (camera, lighting, post, shadows, …). */
    config: PatternConfig<P>;
    /** For `canvas`: every drawable, the authored list and the JSX children the unified Canvas collected. */
    drawables?: readonly DrawableNode[];
    /** A learning canvas's click on one of its items: orbital-canvas resolves the pattern's `{ id, index }` payload. */
    onShapeClick?: (payload: { id: string; index: number }) => void;
    className?: string;
    /** Take the container's height with no minimum; without it the surface is at least 400px tall. */
    fillContainer?: boolean;
    series?: readonly string[];
    tileClickEvent?: string;
    unitClickEvent?: string;
    keyMap?: Record<string, EventKey>;
    keyUpMap?: Record<string, EventKey>;
    /** The canvas's `gestureMap`: a wheel gesture or a touch swipe the camera's own controls do not take. */
    gestureMap?: Record<string, EventKey>;
    /** Edit mode (`editable`): a click that changes the selection, before `selectEvent`. */
    onSelect?: (id: string | null) => void;
    /** Edit mode: a drag dropped on a new scene cell, before `moveEvent`. */
    onMove?: (id: string, x: number, y: number) => void;
    selectEvent?: string;
    moveEvent?: string;
}

/** A release as the view resolves it: a click (`unit`/`tile`), or in edit mode a selection or a move (scene cells). */
interface PickJson {
    unit?: { id: string; x: number; z: number };
    tile?: { x: number; z: number };
    select?: { id: string | null };
    move?: { id: string; x: number; y: number };
    shape?: { id: string; index: number };
}

const log = createLogger('almadar:ui:orbital-canvas3d');

export function OrbitalCanvas3D<P extends Pattern3D>({
    pattern,
    config,
    drawables,
    onShapeClick,
    className,
    fillContainer,
    series,
    tileClickEvent,
    unitClickEvent,
    keyMap,
    keyUpMap,
    gestureMap,
    onSelect,
    onMove,
    selectEvent,
    moveEvent,
}: OrbitalCanvas3DProps<P>): React.ReactElement {
    const engine = useKernelEngine();
    const factory = engine?.canvas3d;
    const eventBus = useEventBus();
    const { t } = useTranslate();
    const reducedMotion = usePrefersReducedMotion();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const viewRef = useRef<KernelCanvas3D | null>(null);
    const drawRef = useRef<() => void>(() => undefined);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(factory ? null : 'no 3D renderer: the host supplies no canvas3d factory to KernelEngineProvider');

    const { theme: baseTheme } = useCanvasTheme(containerRef);
    const seriesKey = series ? series.join('|') : '';
    const theme = useMemo(() => withSeries(baseTheme, series, containerRef.current), [baseTheme, seriesKey]);

    useEffect(() => {
        const element = canvasRef.current;
        if (!factory || !element) return;
        let disposed = false;
        factory(element).then(
            (view) => {
                if (disposed) {
                    view.free();
                    return;
                }
                viewRef.current = view;
                setReady(true);
            },
            (cause: Error) => setError(cause.message),
        );
        return () => {
            disposed = true;
            viewRef.current?.free();
            viewRef.current = null;
            setReady(false);
        };
    }, [factory]);

    // One frame loop: draws when something changed or while damping still moves the camera.
    useEffect(() => {
        if (!ready) return;
        let pending = true;
        let frame = 0;
        const tick = (now: number): void => {
            const view = viewRef.current;
            if (view) {
                let moving = false;
                try {
                    moving = view.frame(now, performance.timeOrigin + now);
                } catch (cause) {
                    setError(String(cause));
                }
                if (pending || moving) {
                    try {
                        view.render();
                    } catch (cause) {
                        setError(String(cause));
                    }
                    pending = false;
                }
            }
            frame = requestAnimationFrame(tick);
        };
        drawRef.current = () => {
            pending = true;
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [ready]);

    useEffect(() => {
        if (error !== null) log.error('scene not drawn', { error });
    }, [error]);

    const nodeJson = useMemo(() => {
        const scope = containerRef.current;
        if (!drawables) return JSON.stringify({ ...config, type: pattern, mode: '3d' });
        const resolved = theme && scope ? resolveDrawableColors([...drawables], (c) => markColor(theme, c, scope, 'ink')) : [...drawables];
        return JSON.stringify({ ...config, type: pattern, mode: '3d', drawables: resolved });
    }, [config, pattern, drawables, theme]);
    const themeJson = useMemo(() => JSON.stringify(theme), [theme]);

    useEffect(() => {
        const view = viewRef.current;
        if (!ready || !view) return;
        try {
            view.setScene(nodeJson, themeJson);
            setError(null);
        } catch (cause) {
            setError(String(cause));
        }
        drawRef.current();
    }, [ready, nodeJson, themeJson]);

    useEffect(() => {
        viewRef.current?.setReducedMotion(reducedMotion);
    }, [ready, reducedMotion]);

    useEffect(() => {
        const element = containerRef.current;
        if (!ready || !element) return;
        const fit = (): void => {
            const box = element.getBoundingClientRect();
            const ratio = window.devicePixelRatio || 1;
            const surface = canvasRef.current;
            if (surface) {
                surface.width = Math.max(1, Math.round(box.width * ratio));
                surface.height = Math.max(1, Math.round(box.height * ratio));
            }
            viewRef.current?.resize(box.width, box.height, ratio);
            drawRef.current();
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ready]);

    useEffect(() => {
        if (!keyMap && !keyUpMap) return;
        const held = new Set<string>();
        const down = (e: KeyboardEvent): void => {
            const code = keyMapCode(e);
            if (held.has(code)) return;
            held.add(code);
            const ev = resolveKeyMapEvent(keyMap, e);
            if (ev) {
                eventBus.emit(`UI:${ev}`, {});
                e.preventDefault();
            }
        };
        const up = (e: KeyboardEvent): void => {
            held.delete(keyMapCode(e));
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

    // Keyed by content: a fresh literal each render must not restart a wheel stream halfway through.
    const gestureKey = gestureMap ? JSON.stringify(gestureMap) : null;
    const gestures = useMemo(() => gestureMap, [gestureKey]);
    const wheelGesture = useRef(createWheelGesture());
    const touch = useRef<{ id: number; x: number; y: number; at: number; taken: boolean } | null>(null);

    useEffect(() => {
        const surface = canvasRef.current;
        if (!ready || !surface) return;
        const wheel = (e: WheelEvent): void => {
            if (viewRef.current?.wheel(e.deltaY)) {
                e.preventDefault();
                drawRef.current();
                return;
            }
            if (!mapsWheel(gestures)) return;
            e.preventDefault();
            const made = wheelGesture.current.feed(wheelPixels(e, surface.clientHeight), e.timeStamp);
            const ev = made && gestures?.[made];
            if (ev) eventBus.emit(`UI:${ev}`, {});
        };
        surface.addEventListener('wheel', wheel, { passive: false });
        return () => surface.removeEventListener('wheel', wheel);
    }, [ready, gestures, eventBus]);

    const point = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
        const box = e.currentTarget.getBoundingClientRect();
        return { x: e.clientX - box.left, y: e.clientY - box.top };
    };

    // The canvas stays mounted through an error: the view is bound to this element, and a remounted canvas would never be drawn.
    return (
        <div ref={containerRef} className={cn('game-canvas-3d relative w-full overflow-hidden', error && 'game-canvas-3d--error', className)} style={fillContainer ? { flex: '1 1 0', height: '100%', minHeight: 0 } : { flex: '1 1 0', minHeight: '400px' }}>
            {error && <div className="game-canvas-3d__error">{t('canvas3d.errorWithMessage', { message: error })}</div>}
            <canvas
                ref={canvasRef}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const { x, y } = point(e);
                    if (e.pointerType !== 'mouse' && mapsSwipe(gestures)) touch.current = { id: e.pointerId, x, y, at: e.timeStamp, taken: false };
                    viewRef.current?.pointerDown(e.pointerId, x, y, e.button, e.pointerType === 'touch');
                }}
                onPointerCancel={(e) => {
                    if (touch.current?.id === e.pointerId) touch.current = null;
                }}
                onPointerMove={(e) => {
                    const { x, y } = point(e);
                    try {
                        if (viewRef.current?.pointerMove(e.pointerId, x, y)) {
                            // The camera moved with this pointer, so the drag is the camera's and no swipe.
                            if (touch.current?.id === e.pointerId) touch.current.taken = true;
                            drawRef.current();
                        }
                    } catch (cause) {
                        setError(String(cause));
                    }
                }}
                onPointerUp={(e) => {
                    const { x, y } = point(e);
                    const view = viewRef.current;
                    if (!view) return;
                    const pick = JSON.parse(view.pointerUp(e.pointerId, x, y, unitClickEvent !== undefined || onShapeClick !== undefined, tileClickEvent !== undefined)) as PickJson | null;
                    const start = touch.current?.id === e.pointerId ? touch.current : null;
                    if (start) touch.current = null;
                    const swipe = start && !start.taken ? swipeGesture(x - start.x, y - start.y, e.timeStamp - start.at) : undefined;
                    const swipeEvent = swipe && gestures?.[swipe];
                    if (swipeEvent) eventBus.emit(`UI:${swipeEvent}`, {});
                    else if (pick?.select) {
                        onSelect?.(pick.select.id);
                        if (selectEvent) eventBus.emit(`UI:${selectEvent}`, { id: pick.select.id });
                    } else if (pick?.move) {
                        onMove?.(pick.move.id, pick.move.x, pick.move.y);
                        if (moveEvent) eventBus.emit(`UI:${moveEvent}`, { id: pick.move.id, x: pick.move.x, y: pick.move.y });
                    } else if (pick?.shape) onShapeClick?.(pick.shape);
                    else if (pick?.unit && unitClickEvent) eventBus.emit(`UI:${unitClickEvent}`, { unitId: pick.unit.id, x: pick.unit.x, z: pick.unit.z });
                    else if (pick?.tile && tileClickEvent) eventBus.emit(`UI:${tileClickEvent}`, { x: pick.tile.x, z: pick.tile.z });
                    drawRef.current();
                }}
            />
        </div>
    );
}
