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

interface Node {
    id: string;
    role: string;
    name: string;
    order: number;
    value?: string;
    expanded?: boolean;
    owner?: string;
    level?: number;
    href?: string;
}

const tree = (nodes: Node[]): string =>
    JSON.stringify(nodes.map((n) => ({ disabled: false, focused: false, multiline: false, rect: { x: 0, y: 0, w: 10, h: 10 }, ...n })));

async function mountWith(nodes: Node[]) {
    install();
    const view = fakeView();
    view.semanticTree.mockImplementation(() => tree(nodes));
    current = { loadModule: () => Promise.reject(new Error('no module in this test')),
        isolated: () => { throw new Error('no isolated engine in this test'); }, sceneCanvas: () => Promise.resolve(view) };
    const result = render(<OrbitalSceneCanvas pattern="canvas" config={{ type: 'canvas', mode: '2d', unitScale: 1 }} width={400} height={300} />);
    await act(async () => {
        await Promise.resolve();
    });
    await runFrames(3);
    const mirror = result.container.querySelector('.orbital-scene-canvas__semantics');
    return { ...result, mirror };
}

describe('G-CROSS-674 the canvas semantic mirror is real document content', () => {
    it('a heading is a heading element holding its text, at its level', async () => {
        const { mirror } = await mountWith([{ id: 'h', role: 'heading', name: 'We build intelligence', level: 1, order: 0 }]);
        const h1 = mirror?.querySelector('h1');
        expect(h1?.textContent).toBe('We build intelligence');
        expect(h1?.hasAttribute('tabindex')).toBe(false);
    });

    it('edge: a heading with no level or a level outside 1 to 6 is a second-level heading', async () => {
        const { mirror } = await mountWith([
            { id: 'a', role: 'heading', name: 'No level', order: 0 },
            { id: 'b', role: 'heading', name: 'Level nine', level: 9, order: 1 },
        ]);
        expect([...(mirror?.querySelectorAll('h2') ?? [])].map((e) => e.textContent)).toEqual(['No level', 'Level nine']);
    });

    it('plain text is a paragraph holding its text, not a tab stop and not an invented role', async () => {
        const { mirror } = await mountWith([{ id: 't', role: 'text', name: 'Runs inside your network', order: 0 }]);
        const p = mirror?.querySelector('p');
        expect(p?.textContent).toBe('Runs inside your network');
        expect(p?.hasAttribute('tabindex')).toBe(false);
        expect(mirror?.querySelector('[role="text"]')).toBeNull();
    });

    it('a link with an address is an anchor a crawler can follow', async () => {
        const { mirror } = await mountWith([{ id: 'l', role: 'link', name: 'About', href: '/about', order: 0 }]);
        const a = mirror?.querySelector('a');
        expect(a?.getAttribute('href')).toBe('/about');
        expect(a?.textContent).toBe('About');
    });

    it('control: a link the canvas gives no address stays an operable link without a made-up address', async () => {
        const { mirror } = await mountWith([{ id: 'l', role: 'link', name: 'About', order: 0 }]);
        expect(mirror?.querySelector('a[href]')).toBeNull();
        const link = mirror?.querySelector('[role="link"]');
        expect(link?.getAttribute('tabindex')).toBe('0');
        expect(link?.getAttribute('aria-label')).toBe('About');
    });

    it('only controls are tab stops', async () => {
        const { mirror } = await mountWith([
            { id: 'h', role: 'heading', name: 'Title', level: 2, order: 0 },
            { id: 't', role: 'text', name: 'Body', order: 1 },
            { id: 'i', role: 'img', name: 'A screenshot', order: 2 },
            { id: 'b', role: 'button', name: 'Next', order: 3 },
        ]);
        expect([...(mirror?.querySelectorAll('[tabindex]') ?? [])].map((e) => e.getAttribute('aria-label'))).toEqual(['Next']);
        expect(mirror?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('A screenshot');
    });

    it('nodes keep the order the canvas hands them (the canvas owns reading order)', async () => {
        const { mirror } = await mountWith([
            { id: 'a', role: 'text', name: 'first', order: 5 },
            { id: 'b', role: 'text', name: 'second', order: 1 },
        ]);
        expect([...(mirror?.querySelectorAll('p') ?? [])].map((e) => e.textContent)).toEqual(['first', 'second']);
    });

    it('a combobox shows its value as its text, not as a value attribute the role does not allow', async () => {
        const { mirror } = await mountWith([{ id: 'c', role: 'combobox', name: 'Language', value: 'English', order: 0 }]);
        const box = mirror?.querySelector('[role="combobox"]');
        expect(box?.hasAttribute('aria-valuetext')).toBe(false);
        expect(box?.textContent).toBe('English');
    });

    it('control: a slider keeps its value text attribute', async () => {
        const { mirror } = await mountWith([{ id: 's', role: 'slider', name: 'Hours', value: 'many', order: 0 }]);
        expect(mirror?.querySelector('[role="slider"]')?.getAttribute('aria-valuetext')).toBe('many');
    });

    it('a closed combobox says it is not expanded and controls nothing', async () => {
        const { mirror } = await mountWith([{ id: 'c', role: 'combobox', name: 'Language', value: 'English', expanded: false, order: 0 }]);
        const box = mirror?.querySelector('[role="combobox"]');
        expect(box?.getAttribute('aria-expanded')).toBe('false');
        expect(box?.hasAttribute('aria-controls')).toBe(false);
        expect(mirror?.querySelector('[role="listbox"]')).toBeNull();
    });

    it('an open combobox controls a named list that holds the options it owns', async () => {
        const { mirror } = await mountWith([
            { id: 'c', role: 'combobox', name: 'Language', value: 'English', expanded: true, order: 0 },
            { id: 'c:0', role: 'option', name: 'English', owner: 'c', order: 0 },
            { id: 'c:1', role: 'option', name: 'Slovenian', owner: 'c', order: 0 },
            { id: 'after', role: 'text', name: 'after', order: 1 },
        ]);
        const box = mirror?.querySelector('[role="combobox"]');
        expect(box?.getAttribute('aria-expanded')).toBe('true');
        const listId = box?.getAttribute('aria-controls');
        const list = listId ? mirror?.querySelector(`[id="${listId}"]`) : null;
        expect(list?.getAttribute('role')).toBe('listbox');
        expect(list?.getAttribute('aria-label')).toBe('Language');
        expect([...(list?.querySelectorAll('[role="option"]') ?? [])].map((e) => e.getAttribute('aria-label'))).toEqual(['English', 'Slovenian']);
        expect(mirror?.querySelectorAll('[role="listbox"]').length).toBe(1);
    });

    it('control: an option that names no owner is not put in a list', async () => {
        const { mirror } = await mountWith([{ id: 'o', role: 'option', name: 'Loose', order: 0 }]);
        expect(mirror?.querySelector('[role="listbox"]')).toBeNull();
        expect(mirror?.querySelector('[role="option"]')?.getAttribute('aria-label')).toBe('Loose');
    });

    it('control: a combobox that does not say whether it is expanded gets no expanded attribute', async () => {
        const { mirror } = await mountWith([{ id: 'c', role: 'combobox', name: 'Language', value: 'English', order: 0 }]);
        expect(mirror?.querySelector('[role="combobox"]')?.hasAttribute('aria-expanded')).toBe(false);
    });

    it('the canvas is hidden from assistive technology once the mirror speaks for it', async () => {
        const { container } = await mountWith([{ id: 't', role: 'text', name: 'Body', order: 0 }]);
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('aria-hidden')).toBe('true');
        expect(canvas?.hasAttribute('role')).toBe(false);
    });

    it('control: a canvas with no mirror is a named image', async () => {
        const { container } = await mountWith([]);
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('role')).toBe('img');
        expect(canvas?.getAttribute('aria-label')).toBeTruthy();
        expect(canvas?.hasAttribute('aria-hidden')).toBe(false);
    });
});
