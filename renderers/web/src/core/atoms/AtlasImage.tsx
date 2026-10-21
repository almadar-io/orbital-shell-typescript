'use client';
import * as React from 'react';
import { getAtlas, subRectFor, isAtlasAsset, type SpriteRef } from '../lib/atlasSlice';
import type { A11yProps } from '@almadar/core';
import { cn } from '../lib/cn';
import { domPassthrough } from '../lib/domPassthrough';

/** Asset-compatible input: sheet url + optional atlas sub-texture reference. */
export interface AtlasImageAsset extends SpriteRef {
    name?: string;
    category?: string;
}

/** @accessibleName alt */
export interface AtlasImageProps extends Omit<A11yProps, 'aria-hidden'> {
    asset?: AtlasImageAsset;
    /** Square pixel size (icon usage). Ignored when `fill`. */
    size?: number;
    width?: number;
    height?: number;
    /** Absolutely fill the nearest positioned ancestor (background usage). */
    fill?: boolean;
    fit?: 'contain' | 'cover' | 'fill';
    alt?: string;
    className?: string;
    style?: React.CSSProperties;
    'aria-hidden'?: boolean;
}

/** slice cache key → dataURL of the extracted sub-image (for CSS border-image / repeat). */
const sliceDataUrlCache = new Map<string, string>();

/**
 * Resolve an atlas slice to a standalone dataURL (extracted once, cached) so CSS can 9-slice or
 * tile it — `border-image`/`background-repeat` can't crop a packed sheet. Returns undefined until
 * the sheet + atlas are loaded; `onReady` re-fires the caller when they land.
 */
export function useAtlasSliceDataUrl(asset: AtlasImageAsset | undefined): string | undefined {
    const [, bump] = React.useReducer((x: number) => x + 1, 0);
    if (!isAtlasAsset(asset)) return undefined;
    const key = `${asset!.atlas}#${asset!.sprite}`;
    const cached = sliceDataUrlCache.get(key);
    if (cached) return cached;
    const atlas = getAtlas(asset!.atlas as string, bump);
    const img = asset?.url ? getSheetImage(asset.url, bump) : null;
    if (!atlas || !img) return undefined;
    const rect = subRectFor(atlas, asset!.sprite as string);
    if (!rect) return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = rect.sw;
    canvas.height = rect.sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh);
    const url = canvas.toDataURL();
    sliceDataUrlCache.set(key, url);
    return url;
}

export interface AtlasPanelProps extends Omit<A11yProps, 'aria-hidden'> {
    asset?: AtlasImageAsset;
    /** Border thickness (source pixels) for the 9-slice cut. */
    borderSlice?: number;
    /** Rendered border width in CSS px. */
    borderWidth?: number;
    /** 'nineSlice' scales edges crisp (panels/buttons); 'repeat' tiles the slice (pattern fills). */
    mode?: 'nineSlice' | 'repeat';
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
    'aria-hidden'?: boolean;
}

/**
 * A container skinned by an atlas slice: 9-sliced panel chrome or a tiled pattern. The pack sheet
 * is cropped once to a dataURL; CSS border-image / background-repeat does the scaling. Falls back
 * to a plain container while the sheet/atlas load.
 */
export function AtlasPanel({ asset, borderSlice = 16, borderWidth = 16, mode = 'nineSlice', className, style, children, 'aria-hidden': ariaHidden, ...rest }: AtlasPanelProps) {
    const dataUrl = useAtlasSliceDataUrl(asset);
    const skin: React.CSSProperties = !dataUrl ? {} : mode === 'repeat'
        ? { backgroundImage: `url(${dataUrl})`, backgroundRepeat: 'repeat' }
        : {
            borderStyle: 'solid',
            borderWidth,
            borderImageSource: `url(${dataUrl})`,
            borderImageSlice: `${borderSlice} fill`,
            borderImageWidth: borderWidth,
            borderImageRepeat: 'stretch',
            imageRendering: 'pixelated',
        };
    return (
        <span {...domPassthrough(rest)} aria-hidden={ariaHidden} className={cn('inline-block', className)} style={{ ...skin, ...style }}>
            {children}
        </span>
    );
}

AtlasPanel.displayName = 'AtlasPanel';

/** sheet url → loaded image (shared across instances; load triggers subscriber re-render). */
const imageCache = new Map<string, HTMLImageElement | null>();
const imageWaiters = new Map<string, Set<() => void>>();

function getSheetImage(url: string, onReady: () => void): HTMLImageElement | null {
    const cached = imageCache.get(url);
    if (cached) return cached;
    (imageWaiters.get(url) ?? imageWaiters.set(url, new Set()).get(url)!).add(onReady);
    if (!imageCache.has(url)) {
        imageCache.set(url, null);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            imageCache.set(url, img);
            imageWaiters.get(url)?.forEach((fn) => fn());
            imageWaiters.delete(url);
        };
        img.src = url;
    }
    return null;
}

/**
 * The one chrome-side renderer for `Asset` images. With `atlas`+`sprite` it draws EXACTLY that
 * sub-rect of the packed sheet into a canvas (never the whole sheet); otherwise it renders the
 * plain `<img>` path. `fill` + `fit` cover background/panel usage (GameShell, card frames).
 */
export function AtlasImage({
    asset,
    size,
    width,
    height,
    fill = false,
    fit = 'contain',
    alt,
    className,
    style,
    'aria-hidden': ariaHidden,
    ...rest
}: AtlasImageProps) {
    const [, bump] = React.useReducer((x: number) => x + 1, 0);
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

    const sliced = isAtlasAsset(asset);
    const atlas = sliced ? getAtlas(asset!.atlas as string, bump) : undefined;
    const img = sliced && asset?.url ? getSheetImage(asset.url, bump) : null;
    const rect = sliced && atlas ? subRectFor(atlas, asset!.sprite as string) : null;

    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !img || !rect) return;
        canvas.width = rect.sw;
        canvas.height = rect.sh;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, rect.sw, rect.sh);
        ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh);
    }, [img, rect?.sx, rect?.sy, rect?.sw, rect?.sh]);

    const w = fill ? '100%' : (width ?? size);
    const h = fill ? '100%' : (height ?? size);
    const boxStyle: React.CSSProperties = {
        ...(fill ? { position: 'absolute', inset: 0 } : {}),
        width: w,
        height: h,
        objectFit: fit,
        imageRendering: 'pixelated',
        ...style,
    };

    if (!asset?.url) return null;

    if (sliced) {
        if (!rect || !img) {
            // Atlas/sheet still loading (or bad sprite name): reserve the box, never flash the sheet.
            return <span aria-hidden className={cn('inline-block flex-shrink-0', className)} style={{ ...boxStyle, objectFit: undefined }} />;
        }
        return (
            <canvas
                ref={canvasRef}
                role={ariaHidden ? undefined : 'img'}
                aria-hidden={ariaHidden}
                aria-label={ariaHidden ? undefined : (alt ?? asset.name ?? asset.category ?? '')}
                {...domPassthrough(rest)}
                className={cn('flex-shrink-0', className)}
                style={boxStyle}
            />
        );
    }

    return (
        <img
            src={asset.url}
            alt={alt ?? asset.name ?? asset.category ?? ''}
            aria-hidden={ariaHidden}
            {...domPassthrough(rest)}
            {...(typeof w === 'number' ? { width: w } : {})}
            {...(typeof h === 'number' ? { height: h } : {})}
            className={cn('flex-shrink-0', className)}
            style={boxStyle}
        />
    );
}

AtlasImage.displayName = 'AtlasImage';
