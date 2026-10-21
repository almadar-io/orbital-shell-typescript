/** Request the next frame; returns its cancel. `requestAnimationFrame` where the host has one. */
export type FrameScheduler = (callback: (nowMs: number) => void) => () => void;
