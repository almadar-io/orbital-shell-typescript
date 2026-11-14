/**
 * A scene canvas keeps its authored aspect ratio unless it is asked to take its container's size (`fillContainer`):
 * it then fills the box, so a canvas whose world follows its own resize report cannot shrink itself
 * (G-ORBITAL-SHELL-TYPESCRIPT-182).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../../../providers/KernelEngineContext', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../providers/KernelEngineContext')>();
    return { ...actual, useKernelEngine: () => null };
});

import { OrbitalSceneCanvas } from '../OrbitalSceneCanvas';

function box(fillContainer: boolean | 'width' | undefined): HTMLElement {
    const { container } = render(
        <OrbitalSceneCanvas pattern="canvas" config={{ type: 'canvas', mode: '2d' }} width={1280} height={800} {...(fillContainer !== undefined ? { fillContainer } : {})} />,
    );
    const el = container.querySelector<HTMLElement>('.orbital-scene-canvas');
    if (el === null) throw new Error('no scene canvas box');
    return el;
}

describe('OrbitalSceneCanvas size', () => {
    it('fills its container and drops the authored aspect ratio when fillContainer is set', () => {
        const el = box(true);
        expect(el.style.aspectRatio).toBe('');
        expect(el.style.maxWidth).toBe('');
        expect(el.style.height).toBe('100%');
    });

    it("with fillContainer 'width' takes the container's width and its authored height in CSS px, so the page scrolls past it", () => {
        const el = box('width');
        expect(el.style.aspectRatio).toBe('');
        expect(el.style.maxWidth).toBe('');
        expect(el.style.height).toBe('800px');
    });

    it('control: without fillContainer it keeps the authored aspect ratio', () => {
        const el = box(undefined);
        expect(el.style.aspectRatio).toBe('1280 / 800');
        expect(el.style.height).toBe('');
    });
});
