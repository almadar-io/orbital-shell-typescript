/**
 * Curated list of the neutral DRAWABLE render-ui pattern components — the
 * dimension-agnostic primitives a canvas draw-host paints under its `children`.
 *
 * These atoms/molecules are R3F-free (the 3D mesh backends live in
 * `lib/drawable/mesh3d`, pulled in only by the code-split 3D host), so they are
 * safe to admit to the public pattern surface. `pattern-sync` discovers
 * `patterns.ts` files by walking the tree and admits exactly the names listed
 * here, taking each one's tier from its source path (atoms / molecules) — so the
 * dispatch/painter infra co-located under `lib/` never leaks in as a pattern.
 * Move this file anywhere under `components/` and the scanner still finds it.
 *
 * @packageDocumentation
 */

export { DrawSprite } from './atoms/DrawSprite';
export { DrawShape } from './atoms/DrawShape';
export { DrawText } from './atoms/DrawText';
export { DrawGroup } from './atoms/DrawGroup';
export { DrawMesh } from './atoms/DrawMesh';
export { DrawSkinnedMesh } from './atoms/DrawSkinnedMesh';
export { DrawSpriteLayer } from './molecules/DrawSpriteLayer';
export { DrawShapeLayer } from './molecules/DrawShapeLayer';
export { DrawTextLayer } from './molecules/DrawTextLayer';
export { DrawFxLayer } from './molecules/DrawFxLayer';
