import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Textarea } from '../../index';
import { EventBusProvider } from '../../index';
import { useEventBus } from '../../index';
import type { BusEvent } from '@almadar/core';

function BusListener({ event, onEvent }: { event: string; onEvent: (payload: unknown) => void }): null {
    const bus = useEventBus();
    const handler = React.useCallback((e: BusEvent) => onEvent(e.payload), [onEvent]);
    React.useEffect(() => bus.on(`UI:${event}`, handler), [bus, event, handler]);
    return null;
}

function renderTextarea(onGo: (payload: unknown) => void) {
    return render(
        <EventBusProvider debug={false}>
            <BusListener event="GO" onEvent={onGo} />
            <Textarea action="GO" defaultValue="hello" />
        </EventBusProvider>,
    );
}

describe('Textarea action', () => {
    it('emits UI:{action} with { value } on Mod+Enter', () => {
        const onGo = vi.fn();
        const { getByRole } = renderTextarea(onGo);
        const textarea = getByRole('textbox');

        fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

        expect(onGo).toHaveBeenCalledTimes(1);
        expect(onGo).toHaveBeenCalledWith({ value: 'hello' });
    });

    it('emits on Ctrl+Enter too', () => {
        const onGo = vi.fn();
        const { getByRole } = renderTextarea(onGo);
        const textarea = getByRole('textbox');

        fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

        expect(onGo).toHaveBeenCalledTimes(1);
    });

    it('does not emit on a plain Enter', () => {
        const onGo = vi.fn();
        const { getByRole } = renderTextarea(onGo);
        const textarea = getByRole('textbox');

        fireEvent.keyDown(textarea, { key: 'Enter' });

        expect(onGo).not.toHaveBeenCalled();
    });

    it('never puts action on the rendered DOM node', () => {
        const { getByRole } = renderTextarea(vi.fn());
        const textarea = getByRole('textbox');

        expect(textarea.getAttribute('action')).toBeNull();
    });
});
