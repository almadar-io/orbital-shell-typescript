/**
 * Painter2D — the portable 2D draw seam.
 *
 * A small verb set that every drawable atom paints through, so a scene stays a
 * pure descriptor tree with no `CanvasRenderingContext2D` reference of its own.
 * The web implementation (`createWebPainter`) wraps a `ctx`; a native platform
 * ships its own implementation of the SAME interface — that is the cross-platform
 * driver (draw-list over DOM overlays). This file is DOM-free: it is the shared
 * contract, importable by any target.
 *
 * Coordinates are PIXELS in the painter's current transform. Scene→pixel mapping
 * is the host projector's job (it maps a core `ScenePos` before calling here), so
 * the painter carries no scene/projection semantics.
 */

/** An opaque, painter-owned handle to a resolved texture (web: a decoded image). */
export interface TextureHandle {
    readonly width: number;
    readonly height: number;
}

/** Destination rectangle for a blit; `w`/`h` omitted → the source's natural size. */
export interface BlitDest {
    x: number;
    y: number;
    w?: number;
    h?: number;
}

/** Source sub-rectangle within a texture (an atlas frame). Omitted → whole texture. */
export interface BlitSrc {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** A polyline/polygon vertex in pixel space. */
export interface PainterPoint {
    x: number;
    y: number;
}

export interface TextStyle {
    color: string;
    /** CSS font shorthand (e.g. `"12px sans-serif"`). */
    font?: string;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
}

/** A drop shadow applied to subsequent draws until cleared. */
export interface PainterShadow {
    color: string;
    blur: number;
}

/** One color stop of a {@link PainterGradient}; `offset` is 0..1 along the gradient. */
export interface PainterGradientStop {
    offset: number;
    color: string;
}

/**
 * A gradient paint style. Coordinates are PIXELS in the painter's current
 * transform — same convention as every other verb; scene→pixel mapping stays
 * the caller's job. Conic `angle` is the start angle in radians.
 */
export type PainterGradient =
    | { kind: 'linear'; x1: number; y1: number; x2: number; y2: number; stops: PainterGradientStop[] }
    | { kind: 'radial'; cx: number; cy: number; r: number; stops: PainterGradientStop[] }
    | { kind: 'conic'; cx: number; cy: number; angle: number; stops: PainterGradientStop[] };

/**
 * A repeating texture paint style. `noise` is a deterministic procedural grain
 * tile (1px cells, magnified by `scale`); `image` tiles a texture URL. `scale`
 * is a pattern-space multiplier in the painter's current transform.
 */
export type PainterPattern =
    | { kind: 'noise'; scale?: number; alpha?: number; color?: string }
    | { kind: 'image'; url: string; scale?: number };

/** What a fill/stroke verb accepts: a CSS color string, a gradient, or a pattern. */
export type PaintStyle = string | PainterGradient | PainterPattern;

/**
 * The verb set. Roughly the union of what `Canvas2D`'s draw passes call on a 2D
 * context, reframed as painter-neutral operations so the same drawable atoms
 * paint identically on web `ctx` and on a native surface.
 */
export interface Painter2D {
    /** Reset the surface to `width`×`height` logical px at device-pixel-ratio `dpr`. */
    setViewport(width: number, height: number, dpr: number): void;
    /** Clear the whole surface. */
    clear(): void;

    save(): void;
    restore(): void;
    translate(x: number, y: number): void;
    scale(sx: number, sy: number): void;
    rotate(radians: number): void;
    /** Global alpha (0..1) for subsequent draws. */
    setAlpha(alpha: number): void;
    /** Drop shadow for subsequent draws; `null` clears it. */
    setShadow(shadow: PainterShadow | null): void;
    /** Composite/blend mode for subsequent draws; `null` restores source-over. */
    setBlend(mode: GlobalCompositeOperation | null): void;
    /** Stroke dash pattern (px in the current transform) for subsequent strokes; `null` restores solid. */
    setLineDash(pattern: readonly number[] | null, offset?: number): void;
    /** Gaussian blur (px in the current transform) applied to subsequent draws; `null`/0 clears it. */
    setBlur(px: number | null): void;
    /** Clip subsequent draws to an SVG path (`d` syntax) in the current transform; lifted by `restore`. */
    clipPath(d: string): void;

    /** Resolve a texture URL to a handle, or `null` if not loaded yet (load is kicked off). */
    resolveTexture(url: string): TextureHandle | null;
    /** Blit a (sub-rect of a) texture to a destination rectangle. */
    blit(tex: TextureHandle, dest: BlitDest, src?: BlitSrc): void;
    /**
     * Blit a source rect through an arbitrary affine `[a,b,c,d,e,f]` (source px →
     * destination px in the painter's current transform). The draw is NOT clipped —
     * the caller clips (e.g. to a skinned triangle) around it.
     */
    blitTransformed(tex: TextureHandle, src: BlitSrc, affine: [number, number, number, number, number, number]): void;

    fillRect(x: number, y: number, w: number, h: number, style: PaintStyle): void;
    strokeRect(x: number, y: number, w: number, h: number, style: PaintStyle, lineWidth?: number): void;
    fillPoly(points: readonly PainterPoint[], style: PaintStyle): void;
    strokePoly(points: readonly PainterPoint[], style: PaintStyle, lineWidth?: number, closed?: boolean): void;
    fillEllipse(cx: number, cy: number, rx: number, ry: number, style: PaintStyle): void;
    strokeEllipse(cx: number, cy: number, rx: number, ry: number, style: PaintStyle, lineWidth?: number): void;
    /** Fill an SVG path (`d` attribute syntax) in the painter's current transform. */
    fillPath(d: string, style: PaintStyle): void;
    /** Stroke an SVG path (`d` attribute syntax) in the painter's current transform. */
    strokePath(d: string, style: PaintStyle, lineWidth?: number): void;

    text(str: string, x: number, y: number, style: TextStyle): void;
}
