'use client';
/**
 * OrbitalCanvas3D — a `canvas` with `mode:"3d"` drawn by orbital-canvas (wasm) on the device the page's GpuHost
 * shares. The host only reads its own surroundings (the theme's CSS, the element size, pointer and keyboard input)
 * and emits the scene's declared events; mapping, drawing, the orbit camera and picking are orbital-canvas's.
 *
 * @packageDocumentation
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EventKey } from '@almadar/core';
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
import type { CanvasProps } from '../../../components/game/molecules/Canvas';

export interface OrbitalCanvas3DProps {
    /** The `canvas` render node's props as the pattern declares them (camera, lighting, post, shadows, …). */
    canvas: Readonly<Omit<CanvasProps, 'children' | 'drawables'>>;
    /** Every drawable: the authored list and the JSX children the unified Canvas collected. */
    drawables: readonly DrawableNode[];
    className?: string;
    series?: readonly string[];
    tileClickEvent?: string;
    unitClickEvent?: string;
    keyMap?: Record<string, EventKey>;
    keyUpMap?: Record<string, EventKey>;
}

interface PickJson {
    unit?: { id: string; x: number; z: number };
    tile?: { x: number; z: number };
}

/** The theme's scene tokens and tones, as orbital-canvas's `SceneTheme` reads them. */
function sceneThemeJson(theme: CanvasTheme | null): string {
    if (!theme) return '{}';
    return JSON.stringify({
        ground: theme.ground === 'transparent' ? null : theme.ground,
        ambient: theme.scene.ambient,
        key: theme.scene.key,
        keyColor: theme.scene.keyColor,
        roughness: theme.scene.roughness,
        metalness: theme.scene.metalness,
        flat: theme.scene.flat,
        outline: theme.scene.outline,
        tones: Object.fromEntries(Object.entries(theme.tones).filter(([, css]) => css !== 'currentColor')),
    });
}

export function OrbitalCanvas3D({
    canvas,
    drawables,
    className,
    series,
    tileClickEvent,
    unitClickEvent,
    keyMap,
    keyUpMap,
}: OrbitalCanvas3DProps): React.ReactElement {
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
                    moving = view.frame(now);
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

    const nodeJson = useMemo(() => {
        const scope = containerRef.current;
        const resolved = theme && scope ? resolveDrawableColors([...drawables], (c) => markColor(theme, c, scope, 'ink')) : [...drawables];
        return JSON.stringify({ ...canvas, type: 'canvas', mode: '3d', drawables: resolved });
    }, [canvas, drawables, theme]);
    const themeJson = useMemo(() => sceneThemeJson(theme), [theme]);

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

    useEffect(() => {
        const surface = canvasRef.current;
        if (!ready || !surface) return;
        const wheel = (e: WheelEvent): void => {
            if (viewRef.current?.wheel(e.deltaY)) {
                e.preventDefault();
                drawRef.current();
            }
        };
        surface.addEventListener('wheel', wheel, { passive: false });
        return () => surface.removeEventListener('wheel', wheel);
    }, [ready]);

    const point = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
        const box = e.currentTarget.getBoundingClientRect();
        return { x: e.clientX - box.left, y: e.clientY - box.top };
    };

    if (error) {
        return (
            <div className={cn('game-canvas-3d game-canvas-3d--error', className)}>
                <div className="game-canvas-3d__error">{t('canvas3d.errorWithMessage', { message: error })}</div>
            </div>
        );
    }

    return (
        <div ref={containerRef} className={cn('game-canvas-3d relative w-full overflow-hidden', className)} style={{ flex: '1 1 0', minHeight: '400px' }}>
            <canvas
                ref={canvasRef}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const { x, y } = point(e);
                    viewRef.current?.pointerDown(e.pointerId, x, y, e.button, e.pointerType === 'touch');
                }}
                onPointerMove={(e) => {
                    const { x, y } = point(e);
                    if (viewRef.current?.pointerMove(e.pointerId, x, y)) drawRef.current();
                }}
                onPointerUp={(e) => {
                    const { x, y } = point(e);
                    const view = viewRef.current;
                    if (!view) return;
                    const pick = JSON.parse(view.pointerUp(e.pointerId, x, y, unitClickEvent !== undefined, tileClickEvent !== undefined)) as PickJson | null;
                    if (pick?.unit && unitClickEvent) eventBus.emit(`UI:${unitClickEvent}`, { unitId: pick.unit.id, x: pick.unit.x, z: pick.unit.z });
                    else if (pick?.tile && tileClickEvent) eventBus.emit(`UI:${tileClickEvent}`, { x: pick.tile.x, z: pick.tile.z });
                    drawRef.current();
                }}
            />
        </div>
    );
}
