'use client';
/**
 * Lazy, on-demand image cache for canvas painting.
 *
 * The descriptor-driven draw-host discovers texture URLs while walking the scene
 * each frame, so it needs a cache keyed by arbitrary URL that lazy-loads on the
 * first miss and returns the decoded image once ready — unlike the eager
 * preload-array `useImageCache` hook. Preserves the `updateAssetStatus`
 * verification hook so `orb verify` / runtime-verify still observe asset loads.
 */
import type { AssetLoadStatus } from '@almadar/core';
import { updateAssetStatus } from './verificationRegistry';

interface Entry {
    img: HTMLImageElement;
    status: AssetLoadStatus;
    /** Fired once when a pending load resolves, so a draw-host can re-draw. */
    onReady?: () => void;
    /** When the last attempt failed; also throttles the next retry. */
    failedAt?: number;
}

/** A failed load is retried after this delay — a transient 404 (e.g. an asset
 *  deploy landing after the code that references it) must self-heal instead of
 *  painting fallback art for the life of the tab. */
const RETRY_AFTER_MS = 5000;

const cache = new Map<string, Entry>();

function startLoad(url: string, onReady: (() => void) | undefined, existing?: Entry): Entry {
    const img = new Image();
    // CORS-clean load: without this the canvas is tainted by cross-origin art and
    // toDataURL/getImageData (the verification capture bridge) throw. The asset
    // CDN serves `access-control-allow-origin: *`, so this is safe.
    img.crossOrigin = 'anonymous';
    const entry: Entry = existing ?? { img, status: 'pending' };
    entry.img = img;
    if (onReady) entry.onReady = onReady;
    img.onload = () => {
        entry.status = 'loaded';
        updateAssetStatus(url, 'loaded');
        entry.onReady?.();
    };
    img.onerror = () => {
        entry.status = 'failed';
        entry.failedAt = Date.now();
        updateAssetStatus(url, 'failed');
        entry.onReady?.(); // a failure is also a state change worth repainting (fallback art)
    };
    img.src = url;
    return entry;
}

/**
 * Return the decoded image for `url`, or `null` if it is not ready yet (a load
 * is kicked off on the first miss). Safe to call every frame — cached after the
 * first request. SSR-safe: returns `null` without a DOM. `onReady` (optional)
 * fires once when a pending load resolves so a caller can trigger a re-draw.
 * A failed entry stays `failed` (fallback art keeps painting) but is re-fetched
 * after {@link RETRY_AFTER_MS}; on success it flips to `loaded` and repaints.
 */
export function getOrLoadImage(url: string, onReady?: () => void): HTMLImageElement | null {
    if (!url || typeof window === 'undefined') return null;
    const existing = cache.get(url);
    if (existing) {
        if (existing.status === 'loaded') return existing.img;
        if (existing.status === 'pending' && onReady) existing.onReady = onReady;
        if (existing.status === 'failed' && Date.now() - (existing.failedAt ?? 0) >= RETRY_AFTER_MS) {
            // Throttle + in-flight guard: stamp the attempt so the next frame
            // doesn't kick a duplicate fetch; status stays 'failed' until it resolves.
            existing.failedAt = Date.now();
            startLoad(url, onReady, existing);
        }
        return null;
    }

    const entry = startLoad(url, onReady);
    cache.set(url, entry);
    updateAssetStatus(url, 'pending');
    return null;
}

/** Test/reset hook — clears the module cache. */
export function clearImageCache(): void {
    cache.clear();
}

/** Current load status for `url` (undefined if never requested). Lets painters
 *  distinguish "pending" from "failed" — both surface as `null` from
 *  {@link getOrLoadImage}. */
export function getImageStatus(url: string): AssetLoadStatus | undefined {
    return cache.get(url)?.status;
}
