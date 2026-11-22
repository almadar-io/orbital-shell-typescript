/**
 * The program says when its scene is laid out (`ready`, std-rasm-surface's laidOut); the canvas marks its container
 * data-orb-ready once it has drawn a frame with that set, the one signal prerender, posters and loaders wait for.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
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
    inputPointer: ReturnType<typeof vi.fn<(kind: string, x: number, y: number, button: number, pointerId: number) => void>>;
    wheel: ReturnType<typeof vi.fn<(x: number, y: number, dx: number, dy: number) => boolean>>;
    zoom: ReturnType<typeof vi.fn<(factor: number, x: number, y: number) => boolean>>;
    doubleTap: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
    takeEvents: ReturnType<typeof vi.fn<() => string>>;
    semanticTree: ReturnType<typeof vi.fn<() => string>>;
    textInput: ReturnType<typeof vi.fn<(target: string, text: string, composing: boolean) => void>>;
    keyInput: ReturnType<typeof vi.fn<(target: string, key: string, shift: boolean, alt: boolean, ctrl: boolean, meta: boolean) => void>>;
    accessAction: ReturnType<typeof vi.fn<(target: string, action: string) => void>>;
    webgpu: ReturnType<typeof vi.fn<() => boolean>>;
    contrastAudit: ReturnType<typeof vi.fn<() => Promise<string>>>;
    contrastAuditAll: ReturnType<typeof vi.fn<() => Promise<string>>>;
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
        inputPointer: vi.fn<(kind: string, x: number, y: number, button: number, pointerId: number) => void>(),
        wheel: vi.fn<(x: number, y: number, dx: number, dy: number) => boolean>(() => false),
        zoom: vi.fn<(factor: number, x: number, y: number) => boolean>(() => false),
        doubleTap: vi.fn<(x: number, y: number) => void>(),
        takeEvents: vi.fn<() => string>(() => '[]'),
        semanticTree: vi.fn<() => string>(() => '[]'),
        textInput: vi.fn<(target: string, text: string, composing: boolean) => void>(),
        keyInput: vi.fn<(target: string, key: string, shift: boolean, alt: boolean, ctrl: boolean, meta: boolean) => void>(),
        accessAction: vi.fn<(target: string, action: string) => void>(),
        webgpu: vi.fn<() => boolean>(() => true),
        contrastAudit: vi.fn<() => Promise<string>>(() => Promise.resolve("[]")),
        contrastAuditAll: vi.fn<() => Promise<string>>(() => Promise.resolve("[]")),
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


const HEADING = JSON.stringify([{ id: "h", role: "heading", name: "Every program", level: 1, order: 0, disabled: false, focused: false, multiline: false, rect: { x: 0, y: 0, w: 10, h: 10 } }]);

async function mount(ready: boolean | undefined, frameCount: number) {
    install();
    const view = fakeView();
    view.semanticTree.mockImplementation(() => HEADING);
    current = { loadModule: () => Promise.reject(new Error("no module in this test")),
        isolated: () => { throw new Error("no isolated engine in this test"); }, sceneCanvas: () => Promise.resolve(view) };
    const result = render(<OrbitalSceneCanvas pattern="canvas" config={{ type: "canvas", mode: "2d", unitScale: 1 }} width={400} height={300} {...(ready !== undefined ? { ready } : {})} />);
    await act(async () => {
        await Promise.resolve();
    });
    await runFrames(frameCount);
    const box = result.container.querySelector<HTMLElement>(".orbital-scene-canvas");
    return { box, mirror: result.container.querySelector(".orbital-scene-canvas__semantics") };
}

describe("the scene canvas says when the program has laid the scene out", () => {
    it("a ready scene marks its container once it has drawn a frame, with its text mirror in place", async () => {
        const { box, mirror } = await mount(true, 3);
        expect(box?.getAttribute("data-orb-ready")).toBe("true");
        expect(mirror?.querySelector("h1")?.textContent).toBe("Every program");
    });

    it("edge: a ready scene that has drawn no frame yet is not marked", async () => {
        const { box } = await mount(true, 0);
        expect(box?.hasAttribute("data-orb-ready")).toBe(false);
    });

    it("control: a scene the program has not marked ready is never marked, however many frames it draws", async () => {
        const { box } = await mount(false, 3);
        expect(box?.hasAttribute("data-orb-ready")).toBe(false);
    });
});
