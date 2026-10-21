'use client';
/**
 * Web implementation of {@link Painter2D} — wraps a `CanvasRenderingContext2D`.
 *
 * This is the ONLY web-coupled part of the drawable pipeline; a native platform
 * provides its own `Painter2D` and every drawable atom is unchanged. The host
 * owns the `<canvas>` sizing; this painter owns the 2D context transform + draws.
 */
import { getOrLoadImage } from './imageCache';
import type {
    PaintStyle,
    Painter2D,
    PainterPoint,
    PainterShadow,
    TextStyle,
    TextureHandle,
    BlitDest,
    BlitSrc,
} from './painter2d';

// Stable handle per decoded image so `resolveTexture` returns the same object
// across frames and `blit` can recover the source without leaking DOM types
// through the shared `TextureHandle` interface.
const handleByImage = new WeakMap<HTMLImageElement, TextureHandle>();
const imageByHandle = new WeakMap<TextureHandle, HTMLImageElement>();

/**
 * Create a {@link Painter2D} backed by a web 2D context. `onAssetLoad` (optional)
 * fires when a texture requested via `resolveTexture` finishes loading, so a
 * draw-host can schedule a re-draw.
 */
// Deterministic 0..1 hash per noise cell — same grain every paint, no RNG state.
const noiseHash = (x: number, y: number): number => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
};

const NOISE_CELLS = 32;

function makeNoiseTile(alpha: number, color: string): HTMLCanvasElement {
    const tile = document.createElement('canvas');
    tile.width = NOISE_CELLS;
    tile.height = NOISE_CELLS;
    const t = tile.getContext('2d');
    if (t) {
        t.fillStyle = color;
        for (let y = 0; y < NOISE_CELLS; y++) {
            for (let x = 0; x < NOISE_CELLS; x++) {
                t.globalAlpha = noiseHash(x, y) * alpha;
                t.fillRect(x, y, 1, 1);
            }
        }
    }
    return tile;
}

export function createWebPainter(ctx: CanvasRenderingContext2D, onAssetLoad?: () => void): Painter2D {
    let vw = 0;
    let vh = 0;
    const patternCache = new Map<string, CanvasPattern | null>();

    const tracePoly = (points: readonly PainterPoint[], closed: boolean): void => {
        if (points.length === 0) return;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        if (closed) ctx.closePath();
    };

    const toCanvasPattern = (style: Extract<PaintStyle, { kind: 'noise' | 'image' }>): CanvasPattern | string => {
        const key = JSON.stringify(style);
        let pattern = patternCache.get(key);
        if (pattern === undefined) {
            if (style.kind === 'noise') {
                pattern = ctx.createPattern(makeNoiseTile(style.alpha ?? 0.12, style.color ?? '#000000'), 'repeat');
            } else {
                const img = getOrLoadImage(style.url, onAssetLoad);
                if (!img) return 'rgba(0,0,0,0)'; // still loading — repaint fills it in
                pattern = ctx.createPattern(img, 'repeat');
            }
            if (pattern && style.scale !== undefined && style.scale !== 1) {
                pattern.setTransform(new DOMMatrix().scale(style.scale));
            }
            patternCache.set(key, pattern);
        }
        return pattern ?? 'rgba(0,0,0,0)';
    };

    const toCanvasStyle = (style: PaintStyle): string | CanvasGradient | CanvasPattern => {
        if (typeof style === 'string') return style;
        if (style.kind === 'noise' || style.kind === 'image') return toCanvasPattern(style);
        const g =
            style.kind === 'linear'
                ? ctx.createLinearGradient(style.x1, style.y1, style.x2, style.y2)
                : style.kind === 'conic'
                  ? ctx.createConicGradient(style.angle, style.cx, style.cy)
                  : ctx.createRadialGradient(style.cx, style.cy, 0, style.cx, style.cy, style.r);
        for (const stop of style.stops) g.addColorStop(stop.offset, stop.color);
        return g;
    };

    return {
        setViewport(width, height, dpr) {
            vw = width;
            vh = height;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        },
        clear() {
            ctx.clearRect(0, 0, vw, vh);
        },

        save() {
            ctx.save();
        },
        restore() {
            ctx.restore();
        },
        translate(x, y) {
            ctx.translate(x, y);
        },
        scale(sx, sy) {
            ctx.scale(sx, sy);
        },
        rotate(radians) {
            ctx.rotate(radians);
        },
        setAlpha(alpha) {
            ctx.globalAlpha = alpha;
        },
        setShadow(shadow: PainterShadow | null) {
            ctx.shadowColor = shadow ? shadow.color : 'transparent';
            ctx.shadowBlur = shadow ? shadow.blur : 0;
        },
        setBlend(mode: GlobalCompositeOperation | null) {
            ctx.globalCompositeOperation = mode ?? 'source-over';
        },
        setLineDash(pattern: readonly number[] | null, offset = 0) {
            ctx.setLineDash(pattern ? [...pattern] : []);
            ctx.lineDashOffset = offset;
        },
        setBlur(px: number | null) {
            ctx.filter = px && px > 0 ? `blur(${px}px)` : 'none';
        },
        clipPath(d: string) {
            ctx.clip(new Path2D(d));
        },

        resolveTexture(url: string): TextureHandle | null {
            const img = getOrLoadImage(url, onAssetLoad);
            if (!img) return null;
            let handle = handleByImage.get(img);
            if (!handle) {
                handle = { width: img.naturalWidth, height: img.naturalHeight };
                handleByImage.set(img, handle);
                imageByHandle.set(handle, img);
            }
            return handle;
        },
        blit(tex: TextureHandle, dest: BlitDest, src?: BlitSrc) {
            const img = imageByHandle.get(tex);
            if (!img) return;
            const dw = dest.w ?? (src ? src.w : tex.width);
            const dh = dest.h ?? (src ? src.h : tex.height);
            if (src) {
                ctx.drawImage(img, src.x, src.y, src.w, src.h, dest.x, dest.y, dw, dh);
            } else {
                ctx.drawImage(img, dest.x, dest.y, dw, dh);
            }
        },
        blitTransformed(tex: TextureHandle, src: BlitSrc, affine: [number, number, number, number, number, number]) {
            const img = imageByHandle.get(tex);
            if (!img) return;
            ctx.save();
            // Compose with the current transform: drawing the src rect AT its own
            // coords under `affine` lands it at affine(srcRect) in the caller's space.
            ctx.transform(affine[0], affine[1], affine[2], affine[3], affine[4], affine[5]);
            ctx.drawImage(img, src.x, src.y, src.w, src.h, src.x, src.y, src.w, src.h);
            ctx.restore();
        },

        fillRect(x, y, w, h, style) {
            ctx.fillStyle = toCanvasStyle(style);
            ctx.fillRect(x, y, w, h);
        },
        strokeRect(x, y, w, h, style, lineWidth = 1) {
            ctx.strokeStyle = toCanvasStyle(style);
            ctx.lineWidth = lineWidth;
            ctx.strokeRect(x, y, w, h);
        },
        fillPoly(points, style) {
            if (points.length === 0) return;
            tracePoly(points, true);
            ctx.fillStyle = toCanvasStyle(style);
            ctx.fill();
        },
        strokePoly(points, style, lineWidth = 1, closed = false) {
            if (points.length === 0) return;
            tracePoly(points, closed);
            ctx.strokeStyle = toCanvasStyle(style);
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        },
        fillEllipse(cx, cy, rx, ry, style) {
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.fillStyle = toCanvasStyle(style);
            ctx.fill();
        },
        strokeEllipse(cx, cy, rx, ry, style, lineWidth = 1) {
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.strokeStyle = toCanvasStyle(style);
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        },
        fillPath(d, style) {
            ctx.fillStyle = toCanvasStyle(style);
            ctx.fill(new Path2D(d));
        },
        strokePath(d, style, lineWidth = 1) {
            ctx.strokeStyle = toCanvasStyle(style);
            ctx.lineWidth = lineWidth;
            ctx.stroke(new Path2D(d));
        },

        text(str: string, x: number, y: number, style: TextStyle) {
            if (style.font) ctx.font = style.font;
            ctx.fillStyle = style.color;
            ctx.textAlign = style.align ?? 'left';
            ctx.textBaseline = style.baseline ?? 'alphabetic';
            ctx.fillText(str, x, y);
        },
    };
}
