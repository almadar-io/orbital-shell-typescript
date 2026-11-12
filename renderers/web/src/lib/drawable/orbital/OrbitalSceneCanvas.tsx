'use client';
/**
 * OrbitalSceneCanvas — a canvas-style pattern (a learning instrument, a diagram, a 2D game `canvas`) mapped and
 * drawn by orbital-canvas (wasm), the same mapper and renderer the native shells use. The host only sizes the
 * surface, forwards pointer input in CSS pixels and emits the events orbital-canvas queues.
 *
 * @packageDocumentation
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '@almadar/logger';
import type { EventKey, EventPayload, PatternConfig, PatternType } from '@almadar/core';
import type { KernelSceneCanvas } from '@almadar/shell-runtime/kernel/wire';
import { useEventBus, cn, useTranslate } from '../../../core';
import { usePrefersReducedMotion } from '../../../core/hooks/usePrefersReducedMotion';
import { useCanvasTheme } from '../../../hooks/useCanvasTheme';
import { useKernelEngine } from '../../../providers/KernelEngineContext';
import { keyMapCode, resolveKeyMapEvent } from '../../keyMapEvent';

export interface OrbitalSceneCanvasProps<P extends PatternType> {
    pattern: P;
    config: PatternConfig<P>;
    className?: string;
    /** The scene's authored size: the surface fills its container's width at this aspect ratio, at most 70vh tall, centered. */
    width: number;
    height: number;
    /**
     * The pattern's callback props the molecule received as functions (`onShapeClick`), by prop name: the scene
     * queues each under its prop name and the host hands that callback the delivered payload.
     */
    callbacks?: Readonly<Record<string, (delivered: EventPayload) => void>>;
    keyMap?: Record<string, EventKey>;
    keyUpMap?: Record<string, EventKey>;
}

interface QueuedEvent {
    event: string;
    payload: EventPayload;
}

/** One wheel notch (100px of deltaY) zooms by 10%, toward the pointer. */
const wheelFactor = (deltaY: number): number => Math.pow(1.1, -deltaY / 100);

const log = createLogger('almadar:ui:orbital-scene-canvas');

export function OrbitalSceneCanvas<P extends PatternType>({ pattern, config, className, width, height, callbacks, keyMap, keyUpMap }: OrbitalSceneCanvasProps<P>): React.ReactElement {
    const engine = useKernelEngine();
    const factory = engine?.sceneCanvas;
    const eventBus = useEventBus();
    const { t } = useTranslate();
    const reducedMotion = usePrefersReducedMotion();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const viewRef = useRef<KernelSceneCanvas | null>(null);
    const drawRef = useRef<() => void>(() => undefined);
    const { theme } = useCanvasTheme(containerRef);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(factory ? null : 'no scene renderer: the host supplies no sceneCanvas factory to KernelEngineProvider');

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

    const flush = (): void => {
        const view = viewRef.current;
        if (!view) return;
        for (const queued of JSON.parse(view.takeEvents()) as QueuedEvent[]) {
            const callback = callbacks?.[queued.event];
            if (callback) callback(queued.payload);
            else eventBus.emit(`UI:${queued.event}`, queued.payload);
        }
    };

    // A repaint queues events of its own (measured text): deliver them every frame, not on the next pointer move.
    const flushRef = useRef(flush);
    flushRef.current = flush;

    useEffect(() => {
        if (!ready) return;
        let pending = true;
        let frame = 0;
        const tick = (now: number): void => {
            const view = viewRef.current;
            if (view) {
                const moving = view.frame(now);
                if (pending || moving) {
                    try {
                        view.render();
                    } catch (cause) {
                        setError(String(cause));
                    }
                    pending = false;
                }
                flushRef.current();
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

    const callbackNames = callbacks ? Object.keys(callbacks).sort().join('|') : '';
    const nodeJson = useMemo(() => {
        const routed = callbackNames === '' ? {} : Object.fromEntries(callbackNames.split('|').map((name) => [name, name]));
        return JSON.stringify({ ...config, ...routed, ...(theme ? { canvasTheme: theme } : {}), type: pattern });
    }, [config, pattern, callbackNames, theme]);

    useEffect(() => {
        const view = viewRef.current;
        if (!ready || !view) return;
        try {
            view.setScene(nodeJson);
            setError(null);
        } catch (cause) {
            setError(String(cause));
        }
        drawRef.current();
    }, [ready, nodeJson]);

    useEffect(() => {
        viewRef.current?.setMotion(!reducedMotion);
        drawRef.current();
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
            try {
                viewRef.current?.resize(box.width, box.height, ratio);
            } catch (cause) {
                setError(String(cause));
            }
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
            const box = surface.getBoundingClientRect();
            if (!viewRef.current?.zoom(wheelFactor(e.deltaY), e.clientX - box.left, e.clientY - box.top)) return;
            e.preventDefault();
            drawRef.current();
        };
        surface.addEventListener('wheel', wheel, { passive: false });
        return () => surface.removeEventListener('wheel', wheel);
    }, [ready]);

    const send = (kind: string, e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>, button: number): void => {
        const view = viewRef.current;
        if (!view) return;
        const box = e.currentTarget.getBoundingClientRect();
        if (kind === 'double-tap') view.doubleTap(e.clientX - box.left, e.clientY - box.top);
        else view.input(kind, e.clientX - box.left, e.clientY - box.top, button);
        flush();
        drawRef.current();
    };

    // The canvas stays mounted through an error: the view is bound to this element, and a remounted canvas would never be drawn.
    return (
        <div
            ref={containerRef}
            className={cn('orbital-scene-canvas relative mx-auto w-full overflow-hidden rounded-container', className)}
            style={{ maxWidth: `min(100%, calc(70vh * ${width} / ${height}))`, aspectRatio: `${width} / ${height}` }}
        >
            <canvas
                ref={canvasRef}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
                onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    send('touch-down', e, e.button);
                }}
                onPointerMove={(e) => {
                    if (e.buttons !== 0 || e.pointerType === 'touch') send('touch-move', e, e.button);
                    else send('hover', e, 0);
                }}
                onPointerLeave={(e) => send('leave', e, 0)}
                onPointerUp={(e) => send('touch-up', e, e.button)}
                onPointerCancel={(e) => send('touch-cancel', e, e.button)}
                onDoubleClick={(e) => send('double-tap', e, 0)}
            />
            {error && (
                <div className="orbital-scene-canvas__error absolute inset-0 z-[1] flex items-center justify-center p-4 text-center text-sm text-[var(--color-error)]">
                    {t('canvas3d.errorWithMessage', { message: error })}
                </div>
            )}
        </div>
    );
}
