import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Canvas2D } from '../Canvas2D';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';
import type { BusEvent } from '@almadar/core';

/** Subscribes to one bus event and forwards every payload to `onEvent`. */
function BusListener({ event, onEvent }: { event: string; onEvent: (payload: unknown) => void }): null {
    const bus = useEventBus();
    const handler = React.useCallback((e: BusEvent) => onEvent(e.payload), [onEvent]);
    React.useEffect(() => bus.on(`UI:${event}`, handler), [bus, event, handler]);
    return null;
}

function renderCanvas(keyMap: Record<string, string>, onEvents: Record<string, (payload: unknown) => void>, extra?: React.ReactNode) {
    return render(
        <EventBusProvider debug={false}>
            {Object.entries(onEvents).map(([event, onEvent]) => (
                <BusListener key={event} event={event} onEvent={onEvent} />
            ))}
            {extra}
            <Canvas2D
                projection="free"
                scale={1}
                tileWidth={0}
                showMinimap={false}
                keyMap={keyMap}
            />
        </EventBusProvider>,
    );
}

describe('Canvas2D keyMap', () => {
    it('fires the mapped event on a bare keydown', () => {
        const onMove = vi.fn();
        renderCanvas({ KeyA: 'MOVE_LEFT' }, { MOVE_LEFT: onMove });

        fireEvent.keyDown(window, { code: 'KeyA' });

        expect(onMove).toHaveBeenCalledTimes(1);
        expect(onMove).toHaveBeenCalledWith({});
    });

    it('does not fire when the same key is dispatched on an input in the tree', () => {
        const onMove = vi.fn();
        const { getByTestId } = renderCanvas(
            { KeyA: 'MOVE_LEFT' },
            { MOVE_LEFT: onMove },
            <input data-testid="text-input" />,
        );
        const input = getByTestId('text-input');

        fireEvent.keyDown(input, { code: 'KeyA' });

        expect(onMove).not.toHaveBeenCalled();
    });

    it('resolves Mod+KeyZ over the bare KeyZ entry under metaKey', () => {
        const onUndo = vi.fn();
        const onOther = vi.fn();
        renderCanvas({ 'Mod+KeyZ': 'UNDO', KeyZ: 'OTHER' }, { UNDO: onUndo, OTHER: onOther });

        fireEvent.keyDown(window, { code: 'KeyZ', metaKey: true });

        expect(onUndo).toHaveBeenCalledTimes(1);
        expect(onOther).not.toHaveBeenCalled();
    });

    it('resolves Mod+KeyZ over the bare KeyZ entry under ctrlKey', () => {
        const onUndo = vi.fn();
        const onOther = vi.fn();
        renderCanvas({ 'Mod+KeyZ': 'UNDO', KeyZ: 'OTHER' }, { UNDO: onUndo, OTHER: onOther });

        fireEvent.keyDown(window, { code: 'KeyZ', ctrlKey: true });

        expect(onUndo).toHaveBeenCalledTimes(1);
        expect(onOther).not.toHaveBeenCalled();
    });

    it('a bare keydown with no modifier still resolves to the bare entry', () => {
        const onUndo = vi.fn();
        const onOther = vi.fn();
        renderCanvas({ 'Mod+KeyZ': 'UNDO', KeyZ: 'OTHER' }, { UNDO: onUndo, OTHER: onOther });

        fireEvent.keyDown(window, { code: 'KeyZ' });

        expect(onOther).toHaveBeenCalledTimes(1);
        expect(onUndo).not.toHaveBeenCalled();
    });
});
