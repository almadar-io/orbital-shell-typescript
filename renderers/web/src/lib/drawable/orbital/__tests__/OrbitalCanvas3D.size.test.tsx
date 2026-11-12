/**
 * The 3D surface keeps its 400px floor unless the scene asks to take its container's size (`fillContainer`): a small
 * scene in a header or a rail is then as tall as the box that holds it.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { KernelCanvas3D } from '@almadar/shell-runtime/kernel/wire';
import type { KernelEngineValue } from '../../../../providers/KernelEngineContext';

let current: KernelEngineValue | null = null;
vi.mock('../../../../providers/KernelEngineContext', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../providers/KernelEngineContext')>();
    return { ...actual, useKernelEngine: () => current };
});

import { OrbitalCanvas3D } from '../OrbitalCanvas3D';

function fakeView(failFirst: boolean): KernelCanvas3D & { scenes: string[] } {
    let calls = 0;
    const scenes: string[] = [];
    return {
        scenes,
        setScene(nodeJson: string): void {
            calls += 1;
            if (failFirst && calls === 1) throw new Error('draw-fx-layer item `fx-1`: `gravity` is missing or not a number');
            scenes.push(nodeJson);
        },
        resize: () => undefined,
        setReducedMotion: () => undefined,
        render: () => undefined,
        frame: () => false,
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
        free: () => undefined,
    };
}

function engine(view: KernelCanvas3D, made: HTMLCanvasElement[]): KernelEngineValue {
    return {
        loadModule: () => Promise.reject(new Error('no module in this test')),
        canvas3d: (canvas: HTMLCanvasElement) => {
            made.push(canvas);
            return Promise.resolve(view);
        },
    };
}

async function surface(fillContainer: boolean | undefined): Promise<HTMLElement> {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
    current = engine(fakeView(false), []);
    const { container } = render(
        <OrbitalCanvas3D pattern="canvas" config={{ type: 'canvas', mode: '3d' }} {...(fillContainer !== undefined ? { fillContainer } : {})} />,
    );
    await act(async () => {
        await Promise.resolve();
    });
    vi.unstubAllGlobals();
    const el = container.querySelector<HTMLElement>('.game-canvas-3d');
    if (!el) throw new Error('the 3D surface did not mount');
    return el;
}

describe('OrbitalCanvas3D size', () => {
    it('takes its container\'s height, with no minimum, when the scene fills its container', async () => {
        const el = await surface(true);
        expect(Number.parseFloat(el.style.minHeight)).toBe(0);
        expect(el.style.height).toBe('100%');
    });

    it('control: a scene that names no size keeps the 400px floor', async () => {
        const el = await surface(undefined);
        expect(el.style.minHeight).toBe('400px');
        expect(el.style.height).toBe('');
    });

    it('control: fillContainer false keeps the 400px floor', async () => {
        const el = await surface(false);
        expect(el.style.minHeight).toBe('400px');
    });
});
