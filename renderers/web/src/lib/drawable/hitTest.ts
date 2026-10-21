/**
 * Drawable click hit-test — the shared walk both canvas hosts (2D + 3D) use to
 * resolve a pointer/raycast at a scene cell to a per-entity id.
 *
 * A drawable descriptor carries an optional source-tagged `id` (see
 * {@link DrawableBase.id}); a board tags its unit sprites (`id: (@u id)`). The
 * host collects every drawn descriptor's `ScenePos` + `id`, builds a
 * `"x,y" → id` index (later descriptors win, so a unit drawn over its tile takes
 * the cell), and resolves a pointer two ways: first against the tagged sprites'
 * painted rects ({@link hitTestSprites} — a body/head click hangs over the cells
 * behind the unit's floor cell), then against the floor-cell index. No id → the
 * host emits only the coordinate (tile click). One owner, both hosts —
 * no per-host duplicate walker.
 */
import type { ScenePos } from '@almadar/core';
import type { DrawableNode } from './paintDispatch';
import { isValidScenePos, spriteRect } from './contract';
import type { DrawableAnchor, Projector } from './contract';
import type { PainterPoint } from '../painter2d';
import type { DrawShapeProps } from '../../components/game/atoms/DrawShape';
import type { DrawSkinnedMeshProps } from '../../components/game/atoms/DrawSkinnedMesh';
import { resolveSkinPose } from '../../components/game/atoms/DrawSkinnedMesh';
import { computeWorldMatrices, skinVertices, vertexBounds, type SkinMesh } from '../skinning';

/** One drawn descriptor's scene position + optional hit-test id. */
export interface DrawnItem {
    pos: ScenePos;
    id?: string;
    /** Placement geometry — present for sprite descriptors and `rect`-kind
     *  shapes (a `draw-shape`/`draw-shape-layer` item declaring `width`/
     *  `height`, e.g. an AABB gizmo) — lets the hit-test resolve a pointer
     *  against the painted rect, not just a fixed one-tile cell box. */
    anchor?: DrawableAnchor;
    width?: number;
    height?: number;
    /** Rotation in radians about the painted rect's centre (same value
     *  `DrawSpriteProps.rotation` / `DrawShapeProps.rotate` paints with) —
     *  lets the hit-test inverse-rotate the test point so a rotated
     *  sprite/shape hit-tests against what is actually drawn. */
    rotation?: number;
}

/** A `draw-shape`'s `rect` kind paints an axis-aligned box sized by
 *  `width`/`height` (in tile units) from its anchor point — the same
 *  `anchor`+`width`+`height` inputs {@link spriteRect} already resolves for
 *  sprites, so a rect item feeds the identical rect derivation instead of
 *  the one-tile fallback. Other shape kinds (`cell`/`ellipse`/`poly`/`path`)
 *  keep the position-only floor-cell hit — they have no rect geometry to test. */
function shapeDrawnItem(n: DrawShapeProps): DrawnItem {
    if (n.shape !== 'rect') return { pos: n.position, id: n.id };
    return { pos: n.position, id: n.id, anchor: n.anchor, width: n.width, height: n.height, rotation: n.rotate };
}

/**
 * A `draw-skinned-mesh`'s painted extent is the AABB of its POSED vertices
 * (local world units relative to `position`'s projected top-left) — not a fixed
 * cell. Feeds the same anchor+width+height rect derivation as a sprite: the pos
 * is offset by the hull's local min, the size is the hull span. Falls back to
 * bind-pose bounds when the mesh is unresolvable (a `meshUrl` still in-flight
 * hit-tests as one floor cell until the repaint lands).
 */
function skinnedMeshDrawnItem(n: DrawSkinnedMeshProps): DrawnItem {
    const mesh: SkinMesh | undefined = n.mesh;
    if (!mesh || n.bones.length === 0) return { pos: n.position, id: n.id };
    const bindWorld = computeWorldMatrices(n.bones, {});
    const curWorld = computeWorldMatrices(n.bones, resolveSkinPose(n));
    const bounds = vertexBounds(skinVertices(mesh, bindWorld, curWorld));
    if (!bounds) return { pos: n.position, id: n.id };
    return {
        pos: { ...n.position, x: n.position.x + bounds.minX, y: n.position.y + bounds.minY },
        id: n.id,
        anchor: 'top-left',
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
    };
}

/** Collect every drawable's scene position + hit id (atoms directly; layers via `items`). */
export function collectDrawnItems(nodes: DrawableNode[]): DrawnItem[] {
    const out: DrawnItem[] = [];
    for (const n of nodes) {
        switch (n.type) {
            case 'draw-sprite':
                if (isValidScenePos(n.position)) out.push({ pos: n.position, id: n.id, anchor: n.anchor, width: n.width, height: n.height, rotation: n.rotation });
                break;
            case 'draw-shape':
                if (isValidScenePos(n.position)) out.push(shapeDrawnItem(n));
                break;
            case 'draw-skinned-mesh':
                if (isValidScenePos(n.position)) out.push(skinnedMeshDrawnItem(n));
                break;
            case 'draw-text':
            case 'draw-group':
            case 'draw-mesh':
                if (isValidScenePos(n.position)) out.push({ pos: n.position, id: n.id });
                break;
            case 'draw-sprite-layer':
                for (const it of n.items) {
                    if (isValidScenePos(it.position)) out.push({ pos: it.position, id: it.id, anchor: it.anchor, width: it.width, height: it.height, rotation: it.rotation });
                }
                break;
            case 'draw-shape-layer':
                for (const it of n.items) {
                    if (isValidScenePos(it.position)) out.push(shapeDrawnItem(it));
                }
                break;
            case 'draw-text-layer':
                for (const it of n.items) {
                    if (isValidScenePos(it.position)) out.push({ pos: it.position, id: it.id });
                }
                break;
            case 'draw-fx-layer':
                // Transient effects are never click targets.
                break;
        }
    }
    return out;
}

/** Build the `"x,y" → id` cell index from the tagged descriptors (later wins). */
export function buildHitIndex(items: DrawnItem[]): Map<string, string> {
    const m = new Map<string, string>();
    for (const it of items) {
        if (it.id !== undefined) m.set(`${it.pos.x},${it.pos.y}`, it.id);
    }
    return m;
}

/**
 * Clone `nodes`, replacing the position of whichever descriptor (top-level,
 * sprite/shape/text-layer item, or nested group item) carries `id` — the live
 * edit-mode drag-preview repaint shared by both hosts. Never touches a painter
 * API; the paint/mesh walk downstream sees an ordinary drawable graph with one
 * position swapped.
 */
export function withPreviewPosition(nodes: DrawableNode[], id: string, pos: ScenePos): DrawableNode[] {
    return nodes.map((n) => {
        if (n.type === 'draw-sprite-layer' || n.type === 'draw-shape-layer' || n.type === 'draw-text-layer') {
            if (!n.items.some((it) => it.id === id)) return n;
            return { ...n, items: n.items.map((it) => (it.id === id ? { ...it, position: pos } : it)) } as DrawableNode;
        }
        if (n.type === 'draw-group') {
            if (!Array.isArray(n.items)) return n;
            return { ...n, items: withPreviewPosition(n.items, id, pos) };
        }
        if (n.id === id && 'position' in n) {
            return { ...n, position: pos };
        }
        return n;
    });
}

/**
 * Resolve a world point to the id of the topmost tagged sprite (or rect-kind
 * shape) whose PAINTED RECT contains it. A sprite anchored `ground` extends
 * `height × tileWidth` above its floor cell (a unit's body/head hangs over the
 * cells behind it); a wide `rect` shape (e.g. an AABB gizmo) extends
 * `width × tileWidth` past its anchor cell — the floor-cell inverse alone
 * mis-resolves either. Testing the painted rect — the same {@link spriteRect}
 * math the painter uses — resolves the click to what is actually under the
 * cursor. Later descriptors win (reverse walk = painter's topmost), matching
 * what the user sees. Returns undefined when no tagged item contains the
 * point; the caller then falls back to the floor-cell inverse (tile click /
 * cell-tagged id).
 */
export function hitTestSprites(items: DrawnItem[], projector: Projector, point: PainterPoint): string | undefined {
    for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.id === undefined) continue;
        const r = spriteRect(projector, { position: it.pos, anchor: it.anchor, width: it.width, height: it.height });
        const test = it.rotation
            ? rotatePoint(point, { x: r.x + r.w / 2, y: r.y + r.h / 2 }, -it.rotation)
            : point;
        if (test.x >= r.x && test.x <= r.x + r.w && test.y >= r.y && test.y <= r.y + r.h) return it.id;
    }
    return undefined;
}

/** Rotate `p` by `radians` about `center` — the same convention the painter's
 *  `ctx.rotate` composes with a translate-to-center, so passing `-rotation`
 *  here maps a point back into the sprite's unrotated local rect. */
function rotatePoint(p: PainterPoint, center: PainterPoint, radians: number): PainterPoint {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}
