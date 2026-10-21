/**
 * Sprite hit-test regression: a `ground`-anchored unit sprite extends
 * `height × tileWidth` above its floor cell, so its body/head hangs over the
 * cells behind it. The floor-cell inverse alone resolves a body click to the
 * WRONG cell; `hitTestSprites` must resolve it to the sprite's id by testing
 * the painted rect (the same `spriteRect` math the painter uses).
 */
import { describe, it, expect } from 'vitest';
import { create2DProjector } from '../../src/lib/drawable/projector';
import { collectDrawnItems, hitTestSprites, buildHitIndex } from '../../src/lib/drawable/hitTest';
import type { DrawSpriteProps } from '../../src/components/game/atoms/DrawSprite';

const TW = 64;
const projector = create2DProjector({ tileWidth: TW, baseOffsetX: 0, layout: 'isometric' });

function unit(id: string, x: number, y: number): DrawSpriteProps {
    return {
        type: 'draw-sprite',
        id,
        position: { x, y },
        asset: { url: `https://cdn.example/${id}.svg`, role: 'unit', category: 'test-fixture' },
        anchor: 'ground',
        width: 0.5,
        height: 0.5,
    };
}

describe('hitTestSprites', () => {
    const items = collectDrawnItems([{ type: 'draw-sprite-layer', items: [unit('p1', 3, 12)] } as never]);
    const anchor = projector.anchorPoint({ x: 3, y: 12 }, 'ground');

    it('resolves a click on the sprite body (above the floor diamond) to the unit', () => {
        // 0.75×height up the sprite: inside the painted rect, but the floor
        // inverse maps this point to the cell BEHIND the unit.
        const hit = hitTestSprites(items, projector, { x: anchor.x, y: anchor.y - 0.75 * 0.5 * TW });
        expect(hit).toBe('p1');
    });

    it('resolves a click at the anchor point to the unit', () => {
        expect(hitTestSprites(items, projector, { x: anchor.x, y: anchor.y - 1 })).toBe('p1');
    });

    it('returns undefined outside the painted rect (caller falls back to the floor cell)', () => {
        // One full sprite-height above the anchor: above the sprite entirely.
        expect(hitTestSprites(items, projector, { x: anchor.x, y: anchor.y - 0.5 * TW - 5 })).toBeUndefined();
        // Beside the sprite.
        expect(hitTestSprites(items, projector, { x: anchor.x + TW, y: anchor.y - 4 })).toBeUndefined();
    });

    it('the floor inverse alone would mis-resolve the body click (regression witness)', () => {
        // The body point belongs to p1 visually, yet it is NOT p1's cell in the
        // cell index — that is the bug this fixes.
        const index = buildHitIndex(items);
        expect(index.get('3,12')).toBe('p1');
        expect(index.get('2,11')).toBeUndefined();
    });

    it('topmost (later) descriptor wins on overlap', () => {
        const overlapped = collectDrawnItems([{ type: 'draw-sprite-layer', items: [unit('back', 3, 11), unit('front', 3, 12)] } as never]);
        const front = projector.anchorPoint({ x: 3, y: 12 }, 'ground');
        // A point inside BOTH rects (front sprite hangs over the back cell).
        expect(hitTestSprites(overlapped, projector, { x: front.x, y: front.y - 4 })).toBe('front');
    });
});
