/**
 * A renderer panic traps the wasm view and leaves its borrow held: every later call on it throws, so after the trap
 * the host must stop calling it (effects, resize, unmount) and the page must stay up.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { KernelCanvas3D } from '@almadar/shell-runtime/kernel/wire';
import type { KernelEngineValue } from '../../../../providers/KernelEngineContext';

let current: KernelEngineValue | null = null;
vi.mock('../../../../providers/KernelEngineContext', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../providers/KernelEngineContext')>();
    return { ...actual, useKernelEngine: () => current };
});

import { OrbitalCanvas3D } from '../OrbitalCanvas3D';

interface FakeView extends KernelCanvas3D {
    setScene: ReturnType<typeof vi.fn<(nodeJson: string, themeJson: string) => void>>;
    resize: ReturnType<typeof vi.fn<(w: number, h: number, r: number) => void>>;
    setReducedMotion: ReturnType<typeof vi.fn<(reduced: boolean) => void>>;
    render: ReturnType<typeof vi.fn<() => void>>;
    frame: ReturnType<typeof vi.fn<(nowMs: number, epochMs: number) => boolean>>;
    free: ReturnType<typeof vi.fn<() => void>>;
}

function fakeView(): FakeView {
    return {
        setScene: vi.fn<(nodeJson: string, themeJson: string) => void>(),
        resize: vi.fn<(w: number, h: number, r: number) => void>(),
        setReducedMotion: vi.fn<(reduced: boolean) => void>(),
        render: vi.fn<() => void>(),
        frame: vi.fn<(nowMs: number, epochMs: number) => boolean>(() => false),
        webgpu: () => true,
        pointerDown: () => undefined,
        pointerMove: () => false,
        pointerLeave: () => undefined,
        pointerUp: () => 'null',
        wheel: () => false,
        camera: () => 'null',
        setCameraPosition: () => false,
        lookAt: () => false,
        resetCamera: () => false,
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
    return [view.frame, view.render, view.setScene, view.resize, view.setReducedMotion, view.free].map((fn) => fn.mock.calls.length);
}

async function mount(view: FakeView, scale: number) {
    install();
    current = { loadModule: () => Promise.reject(new Error('no module in this test')), canvas3d: () => Promise.resolve(view) };
    const ui = (s: number) => (
        <div>
            <p>beside</p>
            <OrbitalCanvas3D pattern="canvas" config={{ type: 'canvas', mode: '3d', unitScale: s }} />
        </div>
    );
    const result = render(ui(scale));
    await act(async () => {
        await Promise.resolve();
    });
    return { ...result, rerenderWith: (s: number) => result.rerender(ui(s)) };
}

describe('OrbitalCanvas3D through a wasm trap', () => {
    it('a view that traps is never called again and the page stays up', async () => {
        const view = fakeView();
        view.render.mockImplementationOnce(() => {
            throw new WebAssembly.RuntimeError('unreachable');
        });
        const { container, rerenderWith, unmount } = await mount(view, 2);
        await runFrames(3);
        expect(container.querySelector('.game-canvas-3d__error')).not.toBeNull();
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
        expect(container.querySelector('.game-canvas-3d__error')).toBeNull();
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
        expect(container.querySelector('.game-canvas-3d__error')).not.toBeNull();
        await act(async () => {
            rerenderWith(3);
        });
        expect(container.querySelector('.game-canvas-3d__error')).toBeNull();
        const before = view.render.mock.calls.length;
        await runFrames(3);
        expect(view.render.mock.calls.length).toBeGreaterThan(before);
    });
});
