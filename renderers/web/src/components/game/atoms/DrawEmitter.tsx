'use client';
/**
 * `draw-emitter` — the particle emitter drawable atom.
 *
 * Each particle instantiates `template` (draw-shape / draw-text / draw-group nodes, positions local to the
 * particle) at `position`, moved by its seeded velocity and `gravity`, with the `over` tracks sampled
 * linearly by age 0..1. A frame is a function of the paint clock, `seed` and the particle index. The orbital
 * canvas paints it; the React component renders `null` and exists so the pattern pipeline registers a
 * `draw-emitter` pattern.
 */
import type React from 'react';
import type { ScenePos } from '@almadar/core';
import type { DrawableBase } from '../../../lib/drawable/contract';
import type { DrawableNode } from '../../../lib/drawable/paintDispatch';

export interface DrawEmitterOver {
    /** Opacity by age; one value holds, several interpolate evenly across 0..1. */
    opacity?: number[];
    /** Scale by age. */
    scale?: number[];
    /** Rotation in radians by age. */
    rotate?: number[];
}

export interface DrawEmitterProps extends DrawableBase {
    type: 'draw-emitter';
    /** Where particles are born. */
    position: ScenePos;
    /** The drawables each particle paints, positions local to the particle. */
    template: DrawableNode[];
    /** Particles born per second. */
    rate: number;
    /** Particles born together at the emitter's start. */
    burst?: number;
    /** Seconds a particle lives. */
    lifetime: number;
    /** Launch angle range in radians (default a full turn). */
    spread?: [number, number];
    /** Launch speed range in px per second. */
    speed: [number, number];
    /** Downward acceleration in px per second squared. */
    gravity?: number;
    /** Randomness seed; with the particle index it fixes every particle. */
    seed: number;
    /** Paint-clock milliseconds the emitter starts at; the burst fires there (default 0). */
    startMs?: number;
    /** Tracks sampled by particle age. */
    over: DrawEmitterOver;
}

/** Registry/standalone stub: the orbital canvas paints this atom; the DOM renders nothing. */
export function DrawEmitter(_props: DrawEmitterProps): React.JSX.Element | null {
    return null;
}

export default DrawEmitter;
