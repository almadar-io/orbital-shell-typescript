/**
 * hitTestSprites — rotation.
 *
 * A `draw-sprite` painted with `rotation` (radians, about its rect centre —
 * the same convention `paintSprite` composes: translate-to-centre, rotate,
 * translate-back) must hit-test against what is actually PAINTED, not its
 * unrotated axis-aligned rect. A 90° rotation on a 1×3 (portrait) rect turns
 * the painted shape into a 3×1 (landscape) rect around the same centre, so
 * the two orientations disagree on enough of the plane to prove the function
 * inverse-rotates the test point rather than ignoring `rotation`.
 */
import { describe, it, expect } from 'vitest';
import { hitTestSprites, collectDrawnItems, type DrawnItem } from '../hitTest';
import { create2DProjector } from '../projector';
import type { DrawShapeProps } from '../../../components/game/atoms/DrawShape';
import type { DrawShapeLayerProps } from '../../../components/game/molecules/DrawShapeLayer';

describe('hitTestSprites', () => {
    // `free` layout: the projector's tileWidth collapses to 1, so world units
    // read directly as painter px — the rect math below is exact, not scaled.
    const projector = create2DProjector({ baseOffsetX: 0, layout: 'free' });

    describe('rotated sprite', () => {
        // position (0,0), anchor top-left, width 1 / height 3 → unrotated rect
        // x:[0,1] y:[0,3], centre (0.5, 1.5). Rotated 90°, the painted shape is
        // the landscape rect x:[-1,2] y:[1,2] around the same centre.
        const item: DrawnItem = {
            pos: { x: 0, y: 0 },
            id: 'sprite-1',
            anchor: 'top-left',
            width: 1,
            height: 3,
            rotation: Math.PI / 2,
        };

        it('hits a point inside the ROTATED bounds that lies outside the unrotated rect', () => {
            expect(hitTestSprites([item], projector, { x: 1.7, y: 1.5 })).toBe('sprite-1');
        });

        it('misses a point inside the UNROTATED rect once rotation moves it out of the painted shape', () => {
            expect(hitTestSprites([item], projector, { x: 0.5, y: 2.8 })).toBeUndefined();
        });

        it('hits dead-centre regardless of orientation', () => {
            expect(hitTestSprites([item], projector, { x: 0.5, y: 1.5 })).toBe('sprite-1');
        });

        it('misses a point clearly outside any orientation', () => {
            expect(hitTestSprites([item], projector, { x: 100, y: 100 })).toBeUndefined();
        });
    });

    describe('unrotated sprite (rotation undefined)', () => {
        const item: DrawnItem = {
            pos: { x: 0, y: 0 },
            id: 'sprite-2',
            anchor: 'top-left',
            width: 1,
            height: 3,
        };

        it('hits inside its own (unrotated) rect', () => {
            expect(hitTestSprites([item], projector, { x: 0.5, y: 2.8 })).toBe('sprite-2');
        });

        it('misses where the rotated-90° variant above would have hit', () => {
            expect(hitTestSprites([item], projector, { x: 1.7, y: 1.5 })).toBeUndefined();
        });
    });

    describe('collectDrawnItems — draw-shape-layer rect geometry', () => {
        // width 3 / height 1 tiles, anchor top-left at (0,0) → painted rect
        // x:[0,3] y:[0,1] (Kura's AABB gizmo: one rect per position-bearing row).
        const wideRect: DrawShapeProps = {
            type: 'draw-shape',
            shape: 'rect',
            position: { x: 0, y: 0 },
            id: 'platform-1',
            anchor: 'top-left',
            width: 3,
            height: 1,
        };
        const layer: DrawShapeLayerProps = { type: 'draw-shape-layer', items: [wideRect] };

        it('carries the shape rect anchor/width/height into the drawn item', () => {
            const [item] = collectDrawnItems([layer]);
            expect(item).toEqual({ pos: { x: 0, y: 0 }, id: 'platform-1', anchor: 'top-left', width: 3, height: 1 });
        });

        it('hits the far end of the wide rect, misses just past it', () => {
            const items = collectDrawnItems([layer]);
            expect(hitTestSprites(items, projector, { x: 2.9, y: 0.5 })).toBe('platform-1');
            expect(hitTestSprites(items, projector, { x: 3.1, y: 0.5 })).toBeUndefined();
        });

        it('leaves non-rect shapes position-only (no fixed-box hit-test geometry)', () => {
            const ellipse: DrawShapeProps = { type: 'draw-shape', shape: 'ellipse', position: { x: 5, y: 5 }, id: 'e1', radiusX: 2 };
            const [item] = collectDrawnItems([{ type: 'draw-shape-layer', items: [ellipse] }]);
            expect(item).toEqual({ pos: { x: 5, y: 5 }, id: 'e1' });
        });
    });
});
