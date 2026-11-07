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
import type { DrawableBase } from '../../../lib/drawable/contract';
import type { DrawableNode } from '../../../lib/drawable/paintDispatch';
import type { FxItem, FxPreset } from '../../../core';

/** Which canvas dimension the expansion targets (axis mapping differs). */
export type FxDimension = '2d' | '3d';

export interface DrawFxLayerProps extends DrawableBase {
    type: 'draw-fx-layer';
    /** The live fx entries — the mechanic's `@entity.fx` list passed whole; `space: "screen"` entries are skipped (the overlay owns those). */
    items: FxItem[];
    /** Consumer-declared effect vocabulary — one row per fx `type` (look, recipe and motion). An item whose `type` has no row draws only from its own fields, and a missing required field is a typed error. */
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

const DEFAULT_TICK_MS = 500;
const DEFAULT_TEXT_COLOR = '#ffe066';
const DEFAULT_FONT_FAMILY = 'system-ui, sans-serif';

/** Expand through the same pure Rust projector native Canvas calls at its paint clock; `tileWidth` is the pixels one world unit paints at. */
export function expandFxLayer(
    node: DrawFxLayerProps,
    epochNowMs: number,
    dim: FxDimension,
    tileWidth: number,
    fontFamily: string | undefined,
): DrawableNode[] {
    const layer = {
        ...node,
        tickMs: node.tickMs ?? DEFAULT_TICK_MS,
        textColor: node.textColor ?? DEFAULT_TEXT_COLOR,
        fontFamily: fontFamily ?? DEFAULT_FONT_FAMILY,
    };
    return JSON.parse(kernelEvaluator().expandFxLayer(JSON.stringify(layer), epochNowMs, dim, tileWidth)) as DrawableNode[];
}

/** Registry/standalone stub — the host paints this molecule; the DOM renders nothing. */
export function DrawFxLayer(_props: DrawFxLayerProps): React.JSX.Element | null {
    return null;
}

export default DrawFxLayer;
