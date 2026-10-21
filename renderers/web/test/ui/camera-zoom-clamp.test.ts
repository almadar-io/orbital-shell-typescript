// @vitest-environment jsdom
/**
 * Zoom clamp regression: the clamp floor must sit below any auto-fit / converted
 * initial zoom (~0.1 on large boards), or wheel/pinch zoom-out snaps IN to the
 * floor once and then stalls dead (the "zoom out doesn't work" bug).
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCamera, MIN_ZOOM, MAX_ZOOM } from '../../src/hooks/useCamera';

const VP = { width: 1000, height: 800 };

describe('useCamera zoom clamp', () => {
    it('zoom-out works repeatedly from a sub-0.5 initial zoom (no snap-in, no stall)', () => {
        const { result } = renderHook(() => useCamera({ zoom: 0.13 }));
        const zooms: number[] = [result.current.cameraRef.current.zoom];
        for (let i = 0; i < 5; i++) {
            act(() => result.current.zoomAtPoint(1 / 1.1, 500, 400, VP));
            zooms.push(result.current.cameraRef.current.zoom);
        }
        for (let i = 1; i < zooms.length; i++) {
            expect(zooms[i]).toBeLessThan(zooms[i - 1]);
        }
        expect(zooms[zooms.length - 1]).toBeGreaterThanOrEqual(MIN_ZOOM);
    });

    it('clamps only at the module bounds', () => {
        const { result } = renderHook(() => useCamera({ zoom: 0.06 }));
        act(() => result.current.zoomAtPoint(1 / 1.1, 500, 400, VP));
        expect(result.current.cameraRef.current.zoom).toBeCloseTo(Math.max(MIN_ZOOM, 0.06 / 1.1), 10);

        const { result: hi } = renderHook(() => useCamera({ zoom: 9.5 }));
        act(() => hi.current.zoomAtPoint(1.1, 500, 400, VP));
        expect(hi.current.cameraRef.current.zoom).toBe(MAX_ZOOM);
    });

    it('handleWheel zooms out below 0.5 without stalling', () => {
        const { result } = renderHook(() => useCamera({ zoom: 0.2 }));
        const wheel = { deltaY: 100, preventDefault: () => undefined } as React.WheelEvent;
        act(() => result.current.handleWheel(wheel));
        expect(result.current.cameraRef.current.zoom).toBeCloseTo(0.18, 10);
    });
});
