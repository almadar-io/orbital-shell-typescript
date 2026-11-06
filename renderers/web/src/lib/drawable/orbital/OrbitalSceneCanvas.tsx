'use client';
/**
 * OrbitalSceneCanvas — a canvas-style pattern (a learning instrument, a diagram, a 2D game `canvas`) mapped and
 * drawn by orbital-canvas (wasm), the same mapper and renderer the native shells use. The host only sizes the
 * surface, forwards pointer input in CSS pixels and emits the events orbital-canvas queues.
 *
 * @packageDocumentation
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PatternConfig, PatternType } from '@almadar/core';
import type { KernelSceneCanvas } from '@almadar/shell-runtime/kernel/wire';
import { useEventBus, cn, useTranslate } from '../../../core';
import { usePrefersReducedMotion } from '../../../core/hooks/usePrefersReducedMotion';
import { useKernelEngine } from '../../../providers/KernelEngineContext';

export interface OrbitalSceneCanvasProps<P extends PatternType> {
    pattern: P;
    config: PatternConfig<P>;
    className?: string;
    /** CSS height of the drawing surface; it fills its container's width. */
    height: number;
}

interface QueuedEvent {
    event: string;
    payload: Parameters<ReturnType<typeof useEventBus>['emit']>[1];
}

/** One wheel notch (100px of deltaY) zooms by 10%, toward the pointer. */
const wheelFactor = (deltaY: number): number => Math.pow(1.1, -deltaY / 100);

export function OrbitalSceneCanvas<P extends PatternType>({ pattern, config, className, height }: OrbitalSceneCanvasProps<P>): React.ReactElement {
    const engine = useKernelEngine();
    const factory = engine?.sceneCanvas;
    const eventBus = useEventBus();
    const { t } = useTranslate();
    const reducedMotion = usePrefersReducedMotion();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const viewRef = useRef<KernelSceneCanvas | null>(null);
    const drawRef = useRef<() => void>(() => undefined);
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
            eventBus.emit(`UI:${queued.event}`, queued.payload);
        }
    };

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
            }
            frame = requestAnimationFrame(tick);
        };
        drawRef.current = () => {
            pending = true;
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [ready]);

    const nodeJson = useMemo(() => JSON.stringify({ ...config, type: pattern }), [config, pattern]);

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
        const surface = canvasRef.current;
        if (!ready || !surface) return;
        const wheel = (e: WheelEvent): void => {
            const box = surface.getBoundingClientRect();
            viewRef.current?.zoom(wheelFactor(e.deltaY), e.clientX - box.left, e.clientY - box.top);
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

    if (error) {
        return (
            <div className={cn('orbital-scene-canvas orbital-scene-canvas--error', className)}>
                <div className="orbital-scene-canvas__error">{t('canvas3d.errorWithMessage', { message: error })}</div>
            </div>
        );
    }

    return (
        <div ref={containerRef} className={cn('orbital-scene-canvas relative w-full overflow-hidden', className)} style={{ height }}>
            <canvas
                ref={canvasRef}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
                onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    send('touch-down', e, e.button);
                }}
                onPointerMove={(e) => {
                    if (e.buttons !== 0 || e.pointerType === 'touch') send('touch-move', e, e.button);
                }}
                onPointerUp={(e) => send('touch-up', e, e.button)}
                onPointerCancel={(e) => send('touch-cancel', e, e.button)}
                onDoubleClick={(e) => send('double-tap', e, 0)}
            />
        </div>
    );
}
