'use client';
/**
 * useUnitSpriteAtlas
 *
 * Loads per-unit sprite-sheet atlases (JSON + PNG) and returns a pure
 * `resolveUnitFrame(unitId)` that computes a single cropped frame rect from
 * the unit's own `animation` + `frame` props — no internal clock, no RAF.
 * The LOLO state machine drives animation/frame; this hook only handles I/O.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IsometricUnit } from '../lib/isometricTypes';
import type {
    ResolvedFrame,
    SpriteAtlas,
} from '../lib/spriteAnimationTypes';
import {
    frameRect,
    resolveSheetDirection,
} from '../lib/spriteAnimation';

/**
 * Resolve the sprite-sheet atlas-JSON URL for a unit.
 *
 * A unit has an atlas iff `unit.spriteSheet.url` is set (explicit metadata wins).
 * No filename-pattern matching — a unit without a `spriteSheet` Asset keeps its static draw.
 */
export function unitAtlasUrl(unit: Pick<IsometricUnit, 'spriteSheet'>): string | null {
    return unit.spriteSheet?.url ?? null;
}

/** Resolve the absolute atlas `.png` sheet URL from the atlas JSON URL + relative sheet path. */
function resolveSheetUrl(atlasUrl: string, relativeSheetPath: string): string {
    try {
        return new URL(relativeSheetPath, atlasUrl).toString();
    } catch {
        const base = atlasUrl.slice(0, atlasUrl.lastIndexOf('/') + 1);
        return `${base}${relativeSheetPath.replace(/^\.\//, '')}`;
    }
}

export interface UseUnitSpriteAtlasResult {
    /** Atlas-JSON URLs successfully loaded — feed these to no one; sheet PNGs are returned below. */
    sheetUrls: string[];
    /** Resolve the current single-frame rect for a unit, or null if its atlas isn't loaded. */
    resolveUnitFrame: (unitId: string) => ResolvedFrame | null;
    /** Whether any atlas is still loading (drives isLoading / keeps RAF alive). */
    pendingCount: number;
}

/**
 * Load per-unit sprite atlases and expose a pure frame resolver.
 * Frame is computed from each unit's own `animation` + `frame` props — no internal clock.
 *
 * @param units - Units whose atlases should be loaded.
 */
export function useUnitSpriteAtlas(units: IsometricUnit[]): UseUnitSpriteAtlasResult {
    const atlasCacheRef = useRef<Map<string, SpriteAtlas>>(new Map());
    const loadingRef = useRef<Set<string>>(new Set());
    const [pendingCount, setPendingCount] = useState(0);
    const [, forceTick] = useState(0);

    // Distinct atlas-JSON URLs requested by the current units (explicit or derived).
    const atlasUrls = useMemo(() => {
        const set = new Set<string>();
        for (const unit of units) {
            const url = unitAtlasUrl(unit);
            if (url) set.add(url);
        }
        return [...set];
    }, [units]);

    // Load atlas JSON files.
    useEffect(() => {
        const cache = atlasCacheRef.current;
        const loading = loadingRef.current;
        const toLoad = atlasUrls.filter((url) => !cache.has(url) && !loading.has(url));
        if (toLoad.length === 0) return;

        let cancelled = false;
        setPendingCount((prev) => prev + toLoad.length);
        for (const url of toLoad) {
            loading.add(url);
            fetch(url)
                .then((res) => (res.ok ? (res.json() as Promise<SpriteAtlas>) : Promise.reject(new Error(String(res.status)))))
                .then((atlas) => {
                    if (cancelled) return;
                    cache.set(url, atlas);
                })
                .catch(() => {
                    /* leave unloaded → unit keeps its static fallback */
                })
                .finally(() => {
                    if (cancelled) return;
                    loading.delete(url);
                    setPendingCount((prev) => Math.max(0, prev - 1));
                    forceTick((n) => n + 1);
                });
        }
        return () => {
            cancelled = true;
        };
    }, [atlasUrls]);

    // Per-unit sheet PNG URLs to preload via the canvas image cache.
    const sheetUrls = useMemo(() => {
        const urls = new Set<string>();
        for (const unit of units) {
            const atlasUrl = unitAtlasUrl(unit);
            if (!atlasUrl) continue;
            const atlas = atlasCacheRef.current.get(atlasUrl);
            if (!atlas) continue;
            for (const rel of Object.values(atlas.sheets)) {
                if (rel) urls.add(resolveSheetUrl(atlasUrl, rel));
            }
        }
        return [...urls];
    }, [units, pendingCount]);

    const resolveUnitFrame = useCallback((unitId: string): ResolvedFrame | null => {
        const unit = units.find((u) => u.id === unitId);
        if (!unit) return null;
        const atlasUrl = unitAtlasUrl(unit);
        if (!atlasUrl) return null;
        const atlas = atlasCacheRef.current.get(atlasUrl);
        if (!atlas) return null;

        // Pure: read animation + frame directly from the unit's LOLO-driven props.
        const animation = unit.animation ?? 'idle';
        const frame = unit.frame ?? 0;

        const def = atlas.animations[animation] ?? atlas.animations.idle;
        if (!def) return null;

        // Default facing SE — direction is a LOLO concern; renderer always faces SE for now.
        const { sheetDir, flipX } = resolveSheetDirection('se');
        const rel = atlas.sheets[sheetDir] ?? atlas.sheets.se ?? atlas.sheets.sw;
        if (!rel) return null;
        const sheetUrl = resolveSheetUrl(atlasUrl, rel);

        const rect = frameRect(frame, def.row, atlas.columns, atlas.frameWidth, atlas.frameHeight);

        return {
            sheetUrl,
            sx: rect.sx,
            sy: rect.sy,
            sw: rect.sw,
            sh: rect.sh,
            flipX,
            applyBreathing: animation === 'idle',
        };
    }, [units]);

    return { sheetUrls, resolveUnitFrame, pendingCount };
}
