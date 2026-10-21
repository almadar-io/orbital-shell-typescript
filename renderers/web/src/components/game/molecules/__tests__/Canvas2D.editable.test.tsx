/**
 * Canvas2D — scene-edit mode (`editable`).
 *
 * jsdom implements neither `PointerEvent` nor `Element.setPointerCapture` —
 * polyfilled below the same way `SplitPane.test.tsx` does, so the real
 * pointerdown/pointermove/pointerup path (not a simulated prop change)
 * exercises the component. jsdom's `HTMLCanvasElement.getContext('2d')`
 * returns `null` (no `canvas` npm package installed), so `draw()` safely
 * no-ops before touching the 2D context — the interaction/event-bus
 * contract under test here never depends on painting, only on the pointer
 * handlers and `hitTestSprites`, so no painter mock is needed.
 *
 * Fixture: one `draw-sprite` at scene (100,100), anchor `top-left`,
 * width/height 40. `projection="free"` + `tileWidth={0}` + `scale={1}`
 * collapse the camera/projector math to the identity (zoom 1, no pan, no
 * auto-centering — `draw()` never runs), so `clientX/clientY` on the
 * jsdom-default zero-rect canvas map 1:1 to both painter-px and scene
 * coordinates. The sprite's painted rect is therefore exactly
 * x:[100,140] y:[100,140] in client px.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Canvas2D } from '../Canvas2D';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';
import type { Asset, BusEvent } from '@almadar/core';
import type { DrawableNode } from '../../../../lib/drawable/paintDispatch';

class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
    }
}

beforeAll(() => {
    if (typeof window.PointerEvent === 'undefined') {
        Object.defineProperty(window, 'PointerEvent', {
            configurable: true,
            writable: true,
            value: PointerEventPolyfill,
        });
    }
    if (!Element.prototype.setPointerCapture) {
        Element.prototype.setPointerCapture = () => {};
    }
    if (!Element.prototype.releasePointerCapture) {
        Element.prototype.releasePointerCapture = () => {};
    }
});

const asset: Asset = { role: 'unit', category: 'test', url: 'test://sprite.png' };

function drawables(): DrawableNode[] {
    return [
        { type: 'draw-sprite', id: 'unit-1', position: { x: 100, y: 100 }, asset, anchor: 'top-left', width: 40, height: 40 },
    ];
}

/** One wide `draw-shape-layer` rect (Kura's AABB gizmo): anchor `top-left` at
 *  scene (100,100), width 120 / height 40 — painted rect x:[100,220] y:[100,140]
 *  under the identity `free` projector (same convention as `drawables()` above). */
function wideShapeDrawables(): DrawableNode[] {
    return [
        {
            type: 'draw-shape-layer',
            items: [
                { type: 'draw-shape', shape: 'rect', id: 'platform-1', position: { x: 100, y: 100 }, anchor: 'top-left', width: 120, height: 40, fill: '#000' },
            ],
        },
    ];
}

/** Subscribes to one bus event and forwards every payload to `onEvent`. */
function BusListener({ event, onEvent }: { event: string; onEvent: (payload: unknown) => void }): null {
    const bus = useEventBus();
    const handler = React.useCallback((e: BusEvent) => onEvent(e.payload), [onEvent]);
    React.useEffect(() => bus.on(`UI:${event}`, handler), [bus, event, handler]);
    return null;
}

function renderCanvas(props: Partial<React.ComponentProps<typeof Canvas2D>> & {
    onTileClick: (payload: unknown) => void;
    onUnitClick: (payload: unknown) => void;
    onSelectEvent: (payload: unknown) => void;
    onMoveEvent: (payload: unknown) => void;
}) {
    const { onTileClick, onUnitClick, onSelectEvent, onMoveEvent, ...rest } = props;
    return render(
        <EventBusProvider debug={false}>
            <BusListener event="TILE_CLICK" onEvent={onTileClick} />
            <BusListener event="UNIT_CLICK" onEvent={onUnitClick} />
            <BusListener event="SELECT_UNIT" onEvent={onSelectEvent} />
            <BusListener event="MOVE_UNIT" onEvent={onMoveEvent} />
            <Canvas2D
                projection="free"
                scale={1}
                tileWidth={0}
                showMinimap={false}
                drawables={drawables()}
                tileClickEvent="TILE_CLICK"
                unitClickEvent="UNIT_CLICK"
                selectEvent="SELECT_UNIT"
                moveEvent="MOVE_UNIT"
                {...rest}
            />
        </EventBusProvider>,
    );
}

describe('Canvas2D editable', () => {
    it('selects the drawable under the pointer on a plain click', () => {
        const onSelect = vi.fn();
        const onTileClick = vi.fn();
        const onUnitClick = vi.fn();
        const onSelectEvent = vi.fn();
        const onMoveEvent = vi.fn();
        const { getByTestId } = renderCanvas({
            editable: true,
            selectedId: null,
            onSelect,
            onTileClick,
            onUnitClick,
            onSelectEvent,
            onMoveEvent,
        });
        const canvas = getByTestId('canvas-2d');

        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 110, clientY: 110 });
        fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 110, clientY: 110 });

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('unit-1');
        expect(onSelectEvent).toHaveBeenCalledTimes(1);
        expect(onSelectEvent).toHaveBeenCalledWith({ id: 'unit-1' });
        expect(onTileClick).not.toHaveBeenCalled();
        expect(onUnitClick).not.toHaveBeenCalled();
    });

    it('selects a wide draw-shape-layer rect at a point beyond one tile from its anchor', () => {
        const onSelect = vi.fn();
        const onSelectEvent = vi.fn();
        const { getByTestId } = renderCanvas({
            editable: true,
            selectedId: null,
            drawables: wideShapeDrawables(),
            onSelect,
            onTileClick: vi.fn(),
            onUnitClick: vi.fn(),
            onSelectEvent,
            onMoveEvent: vi.fn(),
        });
        const canvas = getByTestId('canvas-2d');

        // x:200 is well past [100,140] (a one-tile box anchored at (100,100))
        // but still inside the rect's declared 120-wide painted extent [100,220].
        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 200, clientY: 110 });
        fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 200, clientY: 110 });

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('platform-1');
        expect(onSelectEvent).toHaveBeenCalledWith({ id: 'platform-1' });
    });

    it('toggles selection off on a second click of the already-selected drawable', () => {
        const onSelect = vi.fn();
        const onSelectEvent = vi.fn();
        const { getByTestId } = renderCanvas({
            editable: true,
            selectedId: 'unit-1',
            onSelect,
            onTileClick: vi.fn(),
            onUnitClick: vi.fn(),
            onSelectEvent,
            onMoveEvent: vi.fn(),
        });
        const canvas = getByTestId('canvas-2d');

        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 110, clientY: 110 });
        fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 110, clientY: 110 });

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(null);
        expect(onSelectEvent).toHaveBeenCalledWith({ id: null });
    });

    it('deselects on a click on empty background', () => {
        const onSelect = vi.fn();
        const onSelectEvent = vi.fn();
        const { getByTestId } = renderCanvas({
            editable: true,
            selectedId: 'unit-1',
            onSelect,
            onTileClick: vi.fn(),
            onUnitClick: vi.fn(),
            onSelectEvent,
            onMoveEvent: vi.fn(),
        });
        const canvas = getByTestId('canvas-2d');

        // Well outside the sprite's [100,140]x[100,140] painted rect.
        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 500, clientY: 500 });
        fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 500, clientY: 500 });

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(null);
        expect(onSelectEvent).toHaveBeenCalledWith({ id: null });
    });

    it('fires exactly one moveEvent on drop, never per pointer-move frame, and suppresses tile/unit click events', () => {
        const onMove = vi.fn();
        const onSelect = vi.fn();
        const onTileClick = vi.fn();
        const onUnitClick = vi.fn();
        const onMoveEvent = vi.fn();
        const { getByTestId } = renderCanvas({
            editable: true,
            selectedId: null,
            onSelect,
            onMove,
            onTileClick,
            onUnitClick,
            onSelectEvent: vi.fn(),
            onMoveEvent,
        });
        const canvas = getByTestId('canvas-2d');

        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 110, clientY: 110 });
        // Two intermediate moves past the 5px drag-distance gate — neither must
        // fire onMove/moveEvent; only the drop does, once, with the FINAL delta.
        fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 130, clientY: 120 });
        fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 140 });
        expect(onMove).not.toHaveBeenCalled();
        expect(onMoveEvent).not.toHaveBeenCalled();

        fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 150, clientY: 140 });

        // clientX/clientY map 1:1 to scene px here (see file header): a
        // (150-110, 140-110) = (40, 30) pointer delta moves the sprite from its
        // authored (100,100) to (140,130).
        expect(onMove).toHaveBeenCalledTimes(1);
        expect(onMove).toHaveBeenCalledWith('unit-1', 140, 130);
        expect(onMoveEvent).toHaveBeenCalledTimes(1);
        expect(onMoveEvent).toHaveBeenCalledWith({ id: 'unit-1', x: 140, y: 130 });

        // A drag never toggles selection, and edit mode never plays the
        // play-mode click events.
        expect(onSelect).not.toHaveBeenCalled();
        expect(onTileClick).not.toHaveBeenCalled();
        expect(onUnitClick).not.toHaveBeenCalled();
    });

    it('a sub-threshold move stays a click (selects, does not move)', () => {
        const onMove = vi.fn();
        const onSelect = vi.fn();
        const { getByTestId } = renderCanvas({
            editable: true,
            selectedId: null,
            onSelect,
            onMove,
            onTileClick: vi.fn(),
            onUnitClick: vi.fn(),
            onSelectEvent: vi.fn(),
            onMoveEvent: vi.fn(),
        });
        const canvas = getByTestId('canvas-2d');

        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 110, clientY: 110 });
        fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 112, clientY: 111 }); // |dx|+|dy| = 3 <= 5
        fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 112, clientY: 111 });

        expect(onMove).not.toHaveBeenCalled();
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('unit-1');
    });

    it('play-mode click events fire normally when editable is false (purely additive)', () => {
        const onTileClick = vi.fn();
        const onUnitClick = vi.fn();
        const { getByTestId } = renderCanvas({
            editable: false,
            onTileClick,
            onUnitClick,
            onSelectEvent: vi.fn(),
            onMoveEvent: vi.fn(),
        });
        const canvas = getByTestId('canvas-2d');

        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 110, clientY: 110 });
        fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 110, clientY: 110 });

        expect(onUnitClick).toHaveBeenCalledTimes(1);
        expect(onUnitClick).toHaveBeenCalledWith({ unitId: 'unit-1' });
    });
});
