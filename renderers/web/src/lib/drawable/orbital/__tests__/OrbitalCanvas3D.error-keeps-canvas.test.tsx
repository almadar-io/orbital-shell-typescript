/**
 * The 3D view is bound to the canvas element it was made on: a scene error must not remount that canvas, or the next
 * good scene draws to a detached element and the page stays blank (ui-arena-board-3d, 2026-11-07).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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

async function mount(view: KernelCanvas3D, made: HTMLCanvasElement[], unitScale: number) {
    current = engine(view, made);
    const ui = (scale: number) => <OrbitalCanvas3D pattern="canvas" config={{ type: 'canvas', mode: '3d', unitScale: scale }} />;
    const result = render(ui(unitScale));
    await act(async () => {
        await Promise.resolve();
    });
    return { ...result, rerenderWith: (scale: number) => result.rerender(ui(scale)) };
}

describe('OrbitalCanvas3D through a scene error', () => {
    it('keeps the canvas the view draws to, shows the error over it, and draws the next good scene there', async () => {
        vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
        const view = fakeView(true);
        const made: HTMLCanvasElement[] = [];
        const { container, rerenderWith } = await mount(view, made, 2);
        expect(screen.getByText(/gravity/)).toBeTruthy();
        const canvas = container.querySelector('canvas');
        expect(canvas).toBe(made[0]);
        await act(async () => {
            rerenderWith(3);
        });
        expect(screen.queryByText(/gravity/)).toBeNull();
        expect(container.querySelector('canvas')).toBe(made[0]);
        expect(made).toHaveLength(1);
        expect(view.scenes).toHaveLength(1);
        vi.unstubAllGlobals();
    });

    it('control: a scene that maps keeps one canvas and shows no error', async () => {
        vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
        const view = fakeView(false);
        const made: HTMLCanvasElement[] = [];
        const { container } = await mount(view, made, 2);
        expect(container.querySelector('canvas')).toBe(made[0]);
        expect(container.querySelector('.game-canvas-3d__error')).toBeNull();
        expect(view.scenes).toHaveLength(1);
        vi.unstubAllGlobals();
    });
});
