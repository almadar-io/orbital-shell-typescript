/**
 * A renderer panic traps the wasm view and leaves its borrow held: every later call on it throws, so after the trap
 * the host must stop calling it (effects, resize, unmount) and the page must stay up.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { KernelSceneCanvas } from '@almadar/shell-runtime/kernel/wire';
import type { KernelEngineValue } from '../../../../providers/KernelEngineContext';

let current: KernelEngineValue | null = null;
vi.mock('../../../../providers/KernelEngineContext', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../providers/KernelEngineContext')>();
    return { ...actual, useKernelEngine: () => current };
});

import { OrbitalSceneCanvas } from '../OrbitalSceneCanvas';

interface FakeView extends KernelSceneCanvas {
    setScene: ReturnType<typeof vi.fn<(nodeJson: string) => void>>;
    resize: ReturnType<typeof vi.fn<(w: number, h: number, r: number) => void>>;
    setMotion: ReturnType<typeof vi.fn<(enabled: boolean) => void>>;
    frame: ReturnType<typeof vi.fn<(nowMs: number, epochMs: number) => boolean>>;
    render: ReturnType<typeof vi.fn<() => void>>;
    input: ReturnType<typeof vi.fn<(kind: string, x: number, y: number, button: number) => void>>;
    zoom: ReturnType<typeof vi.fn<(factor: number, x: number, y: number) => boolean>>;
    doubleTap: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
    takeEvents: ReturnType<typeof vi.fn<() => string>>;
    semanticTree: ReturnType<typeof vi.fn<() => string>>;
    textInput: ReturnType<typeof vi.fn<(target: string, text: string, composing: boolean) => void>>;
    keyInput: ReturnType<typeof vi.fn<(target: string, key: string, shift: boolean, alt: boolean, ctrl: boolean, meta: boolean) => void>>;
    accessAction: ReturnType<typeof vi.fn<(target: string, action: string) => void>>;
    webgpu: ReturnType<typeof vi.fn<() => boolean>>;
    free: ReturnType<typeof vi.fn<() => void>>;
}

function fakeView(): FakeView {
    return {
        setScene: vi.fn<(nodeJson: string) => void>(),
        resize: vi.fn<(w: number, h: number, r: number) => void>(),
        setMotion: vi.fn<(enabled: boolean) => void>(),
        frame: vi.fn<(nowMs: number, epochMs: number) => boolean>(() => false),
        render: vi.fn<() => void>(),
        input: vi.fn<(kind: string, x: number, y: number, button: number) => void>(),
        zoom: vi.fn<(factor: number, x: number, y: number) => boolean>(() => false),
        doubleTap: vi.fn<(x: number, y: number) => void>(),
        takeEvents: vi.fn<() => string>(() => '[]'),
        semanticTree: vi.fn<() => string>(() => '[]'),
        textInput: vi.fn<(target: string, text: string, composing: boolean) => void>(),
        keyInput: vi.fn<(target: string, key: string, shift: boolean, alt: boolean, ctrl: boolean, meta: boolean) => void>(),
        accessAction: vi.fn<(target: string, action: string) => void>(),
        webgpu: vi.fn<() => boolean>(() => true),
        free: vi.fn<() => void>(),
    };
}

let frames: FrameRequestCallback[] = [];
let fitters: ResizeObserverCallback[] = [];
const observerOf: ResizeObserver = { observe: () => undefined, unobserve: () => undefined, disconnect: () => undefined };

function install(): void {
    frames = [];
    fitters = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', (): void => undefined);
    vi.stubGlobal(
        'ResizeObserver',
        class {
            constructor(cb: ResizeObserverCallback) {
                fitters.push(cb);
            }
            observe(): void {}
            disconnect(): void {}
        },
    );
}

afterEach(() => vi.unstubAllGlobals());

async function runFrames(count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
        const batch = frames;
        frames = [];
        await act(async () => {
            for (const cb of batch) cb(16 * (i + 1));
        });
    }
}

function counts(view: FakeView): number[] {
    return [
        view.setScene, view.resize, view.setMotion, view.frame, view.render, view.input, view.zoom, view.doubleTap,
        view.takeEvents, view.semanticTree, view.textInput, view.keyInput, view.accessAction, view.webgpu, view.free,
    ].map((fn) => fn.mock.calls.length);
}

async function mount(view: FakeView, scale: number) {
    install();
    current = { loadModule: () => Promise.reject(new Error('no module in this test')), sceneCanvas: () => Promise.resolve(view) };
    const ui = (s: number) => (
        <div>
            <p>beside</p>
            <OrbitalSceneCanvas pattern="canvas" config={{ type: 'canvas', mode: '2d', unitScale: s }} width={400} height={300} />
        </div>
    );
    const result = render(ui(scale));
    await act(async () => {
        await Promise.resolve();
    });
    return { ...result, rerenderWith: (s: number) => result.rerender(ui(s)) };
}

describe('OrbitalSceneCanvas through a wasm trap', () => {
    it('a view that traps is never called again and the page stays up', async () => {
        const view = fakeView();
        view.render.mockImplementationOnce(() => {
            throw new WebAssembly.RuntimeError('unreachable');
        });
        const { container, rerenderWith, unmount } = await mount(view, 2);
        await runFrames(3);
        expect(container.querySelector('.orbital-scene-canvas__error')).not.toBeNull();
        const after = counts(view);
        await runFrames(3);
        await act(async () => {
            rerenderWith(3);
        });
        await act(async () => {
            for (const fit of [...fitters]) fit([], observerOf);
        });
        await runFrames(2);
        expect(screen.getByText('beside')).toBeTruthy();
        expect(counts(view)).toEqual(after);
        expect(() => unmount()).not.toThrow();
        expect(counts(view)).toEqual(after);
    });

    it('a healthy view keeps drawing and is freed on unmount', async () => {
        const view = fakeView();
        const { container, unmount } = await mount(view, 2);
        await runFrames(3);
        expect(container.querySelector('.orbital-scene-canvas__error')).toBeNull();
        expect(view.render.mock.calls.length).toBeGreaterThanOrEqual(1);
        unmount();
        expect(view.free).toHaveBeenCalledTimes(1);
    });

    it('a returned error does not kill the view', async () => {
        const view = fakeView();
        view.setScene.mockImplementationOnce(() => {
            throw new Error('bad scene');
        });
        const { container, rerenderWith } = await mount(view, 2);
        expect(container.querySelector('.orbital-scene-canvas__error')).not.toBeNull();
        await act(async () => {
            rerenderWith(3);
        });
        expect(container.querySelector('.orbital-scene-canvas__error')).toBeNull();
        const before = view.render.mock.calls.length;
        await runFrames(3);
        expect(view.render.mock.calls.length).toBeGreaterThan(before);
    });
});
