'use client';
/**
 * OrbitalSceneCanvas — a canvas-style pattern (a learning instrument, a diagram, a 2D game `canvas`) mapped and
 * drawn by orbital-canvas (wasm), the same mapper and renderer the native shells use. The host only sizes the
 * surface, forwards pointer input in CSS pixels and emits the events orbital-canvas queues.
 *
 * @packageDocumentation
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '@almadar/logger';
import type { EventKey, EventPayload, PatternConfig, PatternType } from '@almadar/core';
import type { KernelSceneCanvas } from '@almadar/shell-runtime/kernel/wire';
import { useEventBus, cn, useTranslate } from '../../../core';
import { usePrefersReducedMotion } from '../../../core/hooks/usePrefersReducedMotion';
import { useCanvasTheme } from '../../../hooks/useCanvasTheme';
import { useKernelEngine } from '../../../providers/KernelEngineContext';
import { createViewGuard, type ViewGuard } from './viewGuard';
import { keyMapCode, resolveKeyMapEvent } from '../../keyMapEvent';

export interface OrbitalSceneCanvasProps<P extends PatternType> {
    pattern: P;
    config: PatternConfig<P>;
    className?: string;
    /** The scene's authored size: the surface fills its container's width at this aspect ratio, at most 70vh tall, centered. */
    width: number;
    height: number;
    /** Take the container's full size instead of the authored aspect ratio; the container must have a definite height. */
    fillContainer?: boolean;
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

/** One node of the semantic tree the canvas exports; `rect` is in CSS pixels, `caret` and the selection in characters. */
interface SemanticView {
    id: string;
    role: string;
    name: string;
    value?: string;
    checked?: boolean;
    disabled: boolean;
    focused: boolean;
    caret?: number;
    selectionStart?: number;
    selectionEnd?: number;
    multiline: boolean;
    order: number;
    rect: { x: number; y: number; w: number; h: number };
}

type AccessActionName = 'focus' | 'activate' | 'increment' | 'decrement';

interface KeyModifiers {
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
}

/** The keys a focused text field hands to the program; everything else reaches it as committed text. */
const EDITING_KEYS: ReadonlySet<string> = new Set(['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'Tab', 'Escape']);

const CHECKED_ROLES: ReadonlySet<string> = new Set(['checkbox', 'switch', 'radio', 'menuitemcheckbox', 'menuitemradio']);

/** Present to assistive technology and focusable, yet unseen and never the target of the pointer (the canvas is). */
const hiddenStyle = (node: SemanticView): React.CSSProperties => ({
    position: 'absolute',
    left: node.rect.x,
    top: node.rect.y,
    width: Math.max(1, node.rect.w),
    height: Math.max(1, node.rect.h),
    margin: 0,
    padding: 0,
    border: 0,
    opacity: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
    background: 'transparent',
    color: 'transparent',
});

/** UTF-16 offset of the `chars`th Unicode scalar value of `text`. */
const utf16Offset = (text: string, chars: number): number => {
    let offset = 0;
    let seen = 0;
    for (const ch of text) {
        if (seen >= chars) break;
        offset += ch.length;
        seen += 1;
    }
    return offset;
};

const modifiersOf = (e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): KeyModifiers => ({
    shift: e.shiftKey,
    alt: e.altKey,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
});

interface MirrorHandlers {
    onAccess: (id: string, action: AccessActionName) => void;
    onText: (id: string, text: string, composing: boolean) => void;
    onKey: (id: string, key: string, mods: KeyModifiers) => void;
    /** The latest tree, read when an event arrives. */
    latest: (id: string) => SemanticView | undefined;
}

/** Sets the field's value and selection from the node: the program's buffer is the truth. */
const syncField = (field: HTMLInputElement | HTMLTextAreaElement, node: SemanticView): void => {
    const value = node.value ?? '';
    if (field.value !== value) field.value = value;
    const start = utf16Offset(value, node.selectionStart ?? node.caret ?? value.length);
    const end = utf16Offset(value, node.selectionEnd ?? node.caret ?? value.length);
    if (field.selectionStart !== start || field.selectionEnd !== end) field.setSelectionRange(start, end);
};

function TextMirror({ node, handlers }: { node: SemanticView; handlers: MirrorHandlers }): React.ReactElement {
    const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    const composing = useRef(false);
    const { id } = node;
    const { onText, onKey, latest } = handlers;

    useLayoutEffect(() => {
        const field = fieldRef.current;
        if (field && !composing.current) syncField(field, node);
    }, [node]);

    const resync = useCallback((): void => {
        requestAnimationFrame(() => {
            const field = fieldRef.current;
            const current = latest(id);
            if (field && current && !composing.current) syncField(field, current);
        });
    }, [id, latest]);

    useEffect(() => {
        const field = fieldRef.current;
        if (!field) return;
        const beforeInput = (e: Event): void => {
            if (!(e instanceof InputEvent)) return;
            if (e.isComposing || e.inputType === 'insertCompositionText') return;
            if (e.inputType === 'deleteContentBackward') onKey(id, 'Backspace', { shift: false, alt: false, ctrl: false, meta: false });
            else if (e.inputType === 'deleteContentForward') onKey(id, 'Delete', { shift: false, alt: false, ctrl: false, meta: false });
            else if (e.inputType.startsWith('insert')) {
                const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
                if (text !== '') onText(id, text, false);
            } else return;
            e.preventDefault();
            resync();
        };
        field.addEventListener('beforeinput', beforeInput);
        return () => field.removeEventListener('beforeinput', beforeInput);
    }, [id, onText, onKey, resync]);

    const shared = {
        ref: fieldRef as React.Ref<never>,
        'aria-label': node.name,
        'aria-disabled': node.disabled || undefined,
        disabled: node.disabled,
        style: hiddenStyle(node),
        autoComplete: 'off',
        autoCorrect: 'off',
        spellCheck: false,
        onCompositionStart: () => {
            composing.current = true;
        },
        onCompositionUpdate: (e: React.CompositionEvent) => handlers.onText(id, e.data, true),
        onCompositionEnd: (e: React.CompositionEvent) => {
            composing.current = false;
            handlers.onText(id, e.data, false);
            handlers.onText(id, '', true);
            resync();
        },
        onKeyDown: (e: React.KeyboardEvent) => {
            if (e.nativeEvent.isComposing || composing.current || !EDITING_KEYS.has(e.key)) return;
            e.preventDefault();
            handlers.onKey(id, e.key, modifiersOf(e));
            resync();
        },
    };
    return node.multiline ? <textarea {...shared} /> : <input type="text" {...shared} />;
}

function SemanticMirror({ nodes, handlers }: { nodes: SemanticView[]; handlers: MirrorHandlers }): React.ReactElement {
    const elements = useRef(new Map<string, HTMLElement>());

    useEffect(() => {
        const focused = nodes.find((n) => n.focused);
        if (!focused) return;
        const slot = elements.current.get(focused.id);
        const el = slot?.querySelector<HTMLElement>('input, textarea') ?? slot;
        if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    }, [nodes]);

    const bind = (id: string) => (el: HTMLElement | null): void => {
        if (el) elements.current.set(id, el);
        else elements.current.delete(id);
    };

    return (
        <div className="orbital-scene-canvas__semantics" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {nodes.map((node) => {
                if (node.role === 'textbox' && node.focused) {
                    return (
                        <div key={node.id} ref={bind(node.id)} style={{ display: 'contents' }}>
                            <TextMirror node={node} handlers={handlers} />
                        </div>
                    );
                }
                const numeric = node.value !== undefined && node.value.trim() !== '' && Number.isFinite(Number(node.value)) ? Number(node.value) : undefined;
                const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
                    if (e.target !== e.currentTarget) return;
                    if (node.role === 'combobox' && node.focused && e.key !== 'Tab' && (EDITING_KEYS.has(e.key) || (e.key.length === 1 && !e.ctrlKey && !e.metaKey))) {
                        e.preventDefault();
                        handlers.onKey(node.id, e.key, modifiersOf(e));
                    } else if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handlers.onAccess(node.id, 'activate');
                    } else if (node.role === 'slider') {
                        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                            e.preventDefault();
                            handlers.onAccess(node.id, 'increment');
                        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                            e.preventDefault();
                            handlers.onAccess(node.id, 'decrement');
                        }
                    }
                };
                return (
                    <div
                        key={node.id}
                        ref={bind(node.id)}
                        role={node.role}
                        tabIndex={0}
                        aria-label={node.name}
                        aria-valuenow={numeric}
                        aria-valuetext={node.role === 'textbox' ? undefined : node.value}
                        aria-checked={CHECKED_ROLES.has(node.role) ? node.checked : undefined}
                        aria-selected={node.role === 'option' ? node.checked : undefined}
                        aria-disabled={node.disabled || undefined}
                        aria-multiline={node.role === 'textbox' ? node.multiline : undefined}
                        style={hiddenStyle(node)}
                        onFocus={() => {
                            if (!handlers.latest(node.id)?.focused) handlers.onAccess(node.id, 'focus');
                        }}
                        onClick={() => handlers.onAccess(node.id, 'activate')}
                        onKeyDown={onKeyDown}
                    >
                        {node.role === 'textbox' ? node.value : undefined}
                    </div>
                );
            })}
        </div>
    );
}

/** A wheel reported in lines turns this many CSS pixels per line (contract 14.2). */
const WHEEL_LINE_PX = 16;

/** One wheel notch (100px of deltaY) zooms by 10%, toward the pointer. */
const wheelFactor = (deltaY: number): number => Math.pow(1.1, -deltaY / 100);

const log = createLogger('almadar:ui:orbital-scene-canvas');

export function OrbitalSceneCanvas<P extends PatternType>({ pattern, config, className, width, height, fillContainer, callbacks, keyMap, keyUpMap }: OrbitalSceneCanvasProps<P>): React.ReactElement {
    const engine = useKernelEngine();
    const factory = engine?.sceneCanvas;
    const eventBus = useEventBus();
    const { t } = useTranslate();
    const reducedMotion = usePrefersReducedMotion();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const viewRef = useRef<KernelSceneCanvas | null>(null);
    const guardRef = useRef<ViewGuard>(createViewGuard());
    const drawRef = useRef<() => void>(() => undefined);
    const { theme } = useCanvasTheme(containerRef);
    const [ready, setReady] = useState(false);
    const [semantics, setSemantics] = useState<SemanticView[]>([]);
    const treeJson = useRef('[]');
    const semanticsRef = useRef<SemanticView[]>([]);
    const [error, setError] = useState<string | null>(factory ? null : 'no scene renderer: the host supplies no sceneCanvas factory to KernelEngineProvider');

    useEffect(() => {
        const element = canvasRef.current;
        if (!factory || !element) return;
        let disposed = false;
        factory(element).then(
            (view) => {
                if (disposed) {
                    createViewGuard().call(() => view.free(), setError);
                    return;
                }
                guardRef.current = createViewGuard();
                viewRef.current = view;
                setReady(true);
            },
            (cause: Error) => setError(cause.message),
        );
        return () => {
            disposed = true;
            const held = viewRef.current;
            if (held) guardRef.current.call(() => held.free(), setError);
            viewRef.current = null;
            treeJson.current = '[]';
            semanticsRef.current = [];
            setSemantics([]);
            setReady(false);
        };
    }, [factory]);

    const flush = (): void => {
        const view = viewRef.current;
        if (!view) return;
        const raw = guardRef.current.call(() => view.takeEvents(), setError);
        if (raw === undefined) return;
        for (const queued of JSON.parse(raw) as QueuedEvent[]) {
            const callback = callbacks?.[queued.event];
            if (callback) callback(queued.payload);
            else eventBus.emit(`UI:${queued.event}`, queued.payload);
        }
    };

    const refreshTree = (): void => {
        const view = viewRef.current;
        if (!view) return;
        const json = guardRef.current.call(() => view.semanticTree(), setError);
        if (json === undefined || json === treeJson.current) return;
        treeJson.current = json;
        const next = JSON.parse(json) as SemanticView[];
        semanticsRef.current = next;
        setSemantics(next);
    };
    const refreshTreeRef = useRef(refreshTree);
    refreshTreeRef.current = refreshTree;

    // A repaint queues events of its own (measured text): deliver them every frame, not on the next pointer move.
    const flushRef = useRef(flush);
    flushRef.current = flush;

    useEffect(() => {
        if (!ready) return;
        let pending = true;
        let frame = 0;
        const tick = (now: number): void => {
            const view = viewRef.current;
            const guard = guardRef.current;
            if (view) {
                const moving = guard.call(() => view.frame(now, performance.timeOrigin + now), setError) ?? false;
                if (pending || moving) {
                    guard.call(() => view.render(), setError);
                    pending = false;
                    refreshTreeRef.current();
                }
                flushRef.current();
            }
            if (guard.dead) return;
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
        const guard = guardRef.current;
        if (guard.call(() => {
            view.setScene(nodeJson);
            return true;
        }, setError) === true) setError(null);
        drawRef.current();
    }, [ready, nodeJson]);

    useEffect(() => {
        const view = viewRef.current;
        if (view) guardRef.current.call(() => view.setMotion(!reducedMotion), setError);
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
            const view = viewRef.current;
            if (view) guardRef.current.call(() => view.resize(box.width, box.height, ratio), setError);
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
            if (e.defaultPrevented) return;
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
            const view = viewRef.current;
            if (!view) return;
            const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : 1;
            const dx = e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaX * box.width : e.deltaX * unit;
            const dy = e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * box.height : e.deltaY * unit;
            if (guardRef.current.call(() => view.wheel(e.clientX - box.left, e.clientY - box.top, dx, dy), setError)) {
                e.preventDefault();
                flushRef.current();
                drawRef.current();
                return;
            }
            if (!guardRef.current.call(() => view.zoom(wheelFactor(e.deltaY), e.clientX - box.left, e.clientY - box.top), setError)) return;
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
        if (kind === 'double-tap') guardRef.current.call(() => view.doubleTap(e.clientX - box.left, e.clientY - box.top), setError);
        else guardRef.current.call(() => view.inputPointer(kind, e.clientX - box.left, e.clientY - box.top, button, 'pointerId' in e ? e.pointerId : 0), setError);
        flush();
        drawRef.current();
    };

    const mirror = useMemo<MirrorHandlers>(() => {
        const after = (): void => {
            flushRef.current();
            refreshTreeRef.current();
            drawRef.current();
        };
        const guarded = (call: (view: KernelSceneCanvas) => void): void => {
            const view = viewRef.current;
            if (!view) return;
            guardRef.current.call(() => call(view), setError);
            after();
        };
        return {
            onAccess: (id, action) => guarded((view) => view.accessAction(id, action)),
            onText: (id, text, composing) => guarded((view) => view.textInput(id, text, composing)),
            onKey: (id, key, mods) => guarded((view) => view.keyInput(id, key, mods.shift, mods.alt, mods.ctrl, mods.meta)),
            latest: (id) => semanticsRef.current.find((n) => n.id === id),
        };
    }, []);

    // The canvas stays mounted through an error: the view is bound to this element, and a remounted canvas would never be drawn.
    return (
        <div
            ref={containerRef}
            className={cn('orbital-scene-canvas relative mx-auto w-full overflow-hidden rounded-container', className)}
            style={fillContainer ? { flex: '1 1 0', height: '100%', minHeight: 0 } : { maxWidth: `min(100%, calc(70vh * ${width} / ${height}))`, aspectRatio: `${width} / ${height}` }}
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
            {semantics.length > 0 && <SemanticMirror nodes={semantics} handlers={mirror} />}
            {error && (
                <div className="orbital-scene-canvas__error absolute inset-0 z-[1] flex items-center justify-center p-4 text-center text-sm text-[var(--color-error)]">
                    {t('canvas3d.errorWithMessage', { message: error })}
                </div>
            )}
        </div>
    );
}
