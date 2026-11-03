'use client';
/**
 * `draw-fx-layer` — the batched transient-effects pass in one descriptor.
 *
 * The descriptor and its paint clock go to the shared Rust projector through
 * the installed kernel WASM module. `std-fx-particles` owns ttl and removal;
 * the projector derives world-space art, sprites, shapes, and messages. The
 * React component renders `null` because its canvas host paints the result.
 */
import type React from 'react';
import { kernelEvaluator, type Asset } from '@almadar/core';
import type { DrawableBase, Projector } from '../../../lib/drawable/contract';
import type { DrawableNode } from '../../../lib/drawable/paintDispatch';
import type { FxItem, FxPreset } from '../../../core';

/** Which canvas dimension the expansion targets (axis mapping differs). */
export type FxDimension = '2d' | '3d';

export interface DrawFxLayerProps extends DrawableBase {
    type: 'draw-fx-layer';
    /** The live fx entries — the mechanic's `@entity.fx` list passed whole; `space: "screen"` entries are skipped (the overlay owns those). */
    items: FxItem[];
    /** Consumer-declared effect vocabulary — one row per fx `type` (look + recipe). Unknown types fall back to a neutral spark burst. */
    presets?: FxPreset[];
    /** Vector art per fx type (an asset-art map: type → anim-state → drawables); a type's `idle` state wins over sprites/procedural. */
    art?: Record<string, Record<string, DrawableNode[]>>;
    /** Sprite asset per fx type (an asset-manifest effects map) — used when no vector art matches. */
    sprites?: Record<string, Asset>;
    /** The fx mechanic's decay tick period in ms; lifetime = maxTtl × tickMs. Default 500. */
    tickMs?: number;
    /** Floating-message text color when an item declares none. Default `#ffe066`. */
    textColor?: string;
}

/** Expand through the same pure Rust projector native Canvas calls at its paint clock. */
export function expandFxLayer(
    node: DrawFxLayerProps,
    epochNowMs: number,
    dim: FxDimension,
    projector?: Projector,
    fontFamily?: string,
): DrawableNode[] {
    return JSON.parse(kernelEvaluator().expandFxLayer(
        JSON.stringify(node), epochNowMs, dim, projector?.tileWidth, fontFamily,
    )) as DrawableNode[];
}

/** Registry/standalone stub — the host paints this molecule; the DOM renders nothing. */
export function DrawFxLayer(_props: DrawFxLayerProps): React.JSX.Element | null {
    return null;
}

export default DrawFxLayer;
