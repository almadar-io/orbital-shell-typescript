import { describe, it, expect } from 'vitest';
import { createWheelGesture, mapsSwipe, mapsWheel, swipeGesture, wheelPixels, SWIPE_MS, SWIPE_TRAVEL, WHEEL_QUIET_MS, WHEEL_TRAVEL } from '../gestureMapEvent';

describe('wheelPixels', () => {
    it('passes pixel deltas through', () => {
        expect(wheelPixels({ deltaY: 42, deltaMode: 0 }, 800)).toBe(42);
    });

    it('scales a line delta to pixels', () => {
        expect(wheelPixels({ deltaY: 3, deltaMode: 1 }, 800)).toBe(48);
    });

    it('scales a page delta by the surface height', () => {
        expect(wheelPixels({ deltaY: -1, deltaMode: 2 }, 800)).toBe(-800);
    });
});

describe('createWheelGesture', () => {
    it('answers WheelDown once a stream has travelled far enough down', () => {
        const wheel = createWheelGesture();
        expect(wheel.feed(WHEEL_TRAVEL / 2, 0)).toBeUndefined();
        expect(wheel.feed(WHEEL_TRAVEL / 2, 16)).toBe('WheelDown');
    });

    it('answers WheelUp for travel the other way', () => {
        expect(createWheelGesture().feed(-WHEEL_TRAVEL, 0)).toBe('WheelUp');
    });

    it('answers one gesture for a whole fling, inertia included', () => {
        const wheel = createWheelGesture();
        const answers = Array.from({ length: 60 }, (_, i) => wheel.feed(20, i * 16));
        expect(answers.filter((a) => a !== undefined)).toEqual(['WheelDown']);
    });

    it('answers again after the stream has gone quiet', () => {
        const wheel = createWheelGesture();
        expect(wheel.feed(WHEEL_TRAVEL, 0)).toBe('WheelDown');
        expect(wheel.feed(WHEEL_TRAVEL, WHEEL_QUIET_MS + 1)).toBe('WheelDown');
    });

    it('control: travel below the threshold answers nothing', () => {
        const wheel = createWheelGesture();
        expect(wheel.feed(WHEEL_TRAVEL - 1, 0)).toBeUndefined();
    });

    it('control: small travel left over from an ended stream does not carry into the next', () => {
        const wheel = createWheelGesture();
        expect(wheel.feed(WHEEL_TRAVEL - 1, 0)).toBeUndefined();
        expect(wheel.feed(2, WHEEL_QUIET_MS + 1)).toBeUndefined();
    });
});

describe('swipeGesture', () => {
    it('names a swipe by the way the finger moved', () => {
        expect(swipeGesture(0, -SWIPE_TRAVEL, 200)).toBe('SwipeUp');
        expect(swipeGesture(0, SWIPE_TRAVEL, 200)).toBe('SwipeDown');
        expect(swipeGesture(-SWIPE_TRAVEL, 0, 200)).toBe('SwipeLeft');
        expect(swipeGesture(SWIPE_TRAVEL, 0, 200)).toBe('SwipeRight');
    });

    it('takes the longer axis of a diagonal', () => {
        expect(swipeGesture(SWIPE_TRAVEL * 2, SWIPE_TRAVEL, 200)).toBe('SwipeRight');
    });

    it('control: a tap is no swipe', () => {
        expect(swipeGesture(3, -4, 120)).toBeUndefined();
    });

    it('control: a long press that drifted is no swipe', () => {
        expect(swipeGesture(0, -SWIPE_TRAVEL * 2, SWIPE_MS + 1)).toBeUndefined();
    });
});

describe('mapsWheel and mapsSwipe', () => {
    it('read the entries a map declares', () => {
        expect(mapsWheel({ WheelDown: 'NEXT' })).toBe(true);
        expect(mapsSwipe({ SwipeLeft: 'NEXT' })).toBe(true);
    });

    it('control: a map of the other kind, or none, maps nothing', () => {
        expect(mapsWheel({ SwipeLeft: 'NEXT' })).toBe(false);
        expect(mapsSwipe({ WheelDown: 'NEXT' })).toBe(false);
        expect(mapsWheel(undefined)).toBe(false);
        expect(mapsSwipe(undefined)).toBe(false);
    });
});
