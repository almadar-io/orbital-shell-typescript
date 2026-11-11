import type { EventKey } from '@almadar/core';

/** A canvas's `gestureMap`: a gesture name to the board's semantic event. */
export type GestureMap = Record<string, EventKey>;

export type Gesture = 'WheelUp' | 'WheelDown' | 'SwipeUp' | 'SwipeDown' | 'SwipeLeft' | 'SwipeRight';

/** Wheel travel, in CSS pixels, that makes a wheel stream a gesture. */
export const WHEEL_TRAVEL = 30;
/** A wheel stream this quiet has ended; a trackpad's inertia keeps it alive until then. */
export const WHEEL_QUIET_MS = 180;
/** Finger travel, in CSS pixels, that makes a touch a swipe. */
export const SWIPE_TRAVEL = 48;
/** A touch held longer than this is a press or a drag, never a swipe. */
export const SWIPE_MS = 900;

const LINE_PX = 16;

/** A wheel event's vertical travel in CSS pixels, whatever unit the device reports. */
export function wheelPixels(e: { deltaY: number; deltaMode: number }, pageHeight: number): number {
    if (e.deltaMode === 1) return e.deltaY * LINE_PX;
    if (e.deltaMode === 2) return e.deltaY * pageHeight;
    return e.deltaY;
}

export interface WheelGesture {
    /** Feed one wheel event; answers the gesture the first time its stream has travelled far enough. */
    feed(pixels: number, at: number): Gesture | undefined;
}

/**
 * One wheel stream is one gesture: a mouse notch, or a trackpad fling with all of its inertia.
 * The stream ends after `WHEEL_QUIET_MS` without an event.
 */
export function createWheelGesture(): WheelGesture {
    let travel = 0;
    let fired = false;
    let last = Number.NEGATIVE_INFINITY;
    return {
        feed(pixels, at) {
            if (at - last > WHEEL_QUIET_MS) {
                travel = 0;
                fired = false;
            }
            last = at;
            if (fired) return undefined;
            travel += pixels;
            if (Math.abs(travel) < WHEEL_TRAVEL) return undefined;
            fired = true;
            return travel > 0 ? 'WheelDown' : 'WheelUp';
        },
    };
}

/** The swipe a touch made from press to release, named by the way the finger moved. */
export function swipeGesture(dx: number, dy: number, heldMs: number): Gesture | undefined {
    if (heldMs > SWIPE_MS) return undefined;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < SWIPE_TRAVEL) return undefined;
    if (ax > ay) return dx > 0 ? 'SwipeRight' : 'SwipeLeft';
    return dy > 0 ? 'SwipeDown' : 'SwipeUp';
}

export function mapsWheel(map: GestureMap | undefined): boolean {
    return map !== undefined && (map.WheelUp !== undefined || map.WheelDown !== undefined);
}

export function mapsSwipe(map: GestureMap | undefined): boolean {
    return map !== undefined && (map.SwipeUp !== undefined || map.SwipeDown !== undefined || map.SwipeLeft !== undefined || map.SwipeRight !== undefined);
}
