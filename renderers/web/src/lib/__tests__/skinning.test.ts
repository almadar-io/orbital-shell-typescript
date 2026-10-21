/**
 * skinning — FK world matrices, linear blend skinning, triangle affine solve.
 *
 * A two-bone chain (root at the origin, child pivoting at (1,0)) proves the
 * FK composition: rotating the ROOT must swing the child with it (a vertex
 * fully weighted to the child still moves), and the skinned result must equal
 * the rigid world transform of the bone for full weights, the blend for
 * partial ones.
 */
import { describe, it, expect } from 'vitest';
import {
    applyAffine,
    composeAffine,
    computeWorldMatrices,
    invertAffine,
    skinVertices,
    triangleAffine,
    vertexBounds,
    type BoneDef,
    type SkinMesh,
} from '../skinning';

const bones: BoneDef[] = [
    { name: 'root', parent: null, pivot: [0, 0], tip: [1, 0] },
    { name: 'child', parent: 'root', pivot: [1, 0], tip: [2, 0] },
];

const closeTo = (actual: [number, number], x: number, y: number): void => {
    expect(actual[0]).toBeCloseTo(x, 6);
    expect(actual[1]).toBeCloseTo(y, 6);
};

describe('computeWorldMatrices', () => {
    it('yields identity per bone at the bind pose', () => {
        const world = computeWorldMatrices(bones, {});
        for (const m of world) closeTo(applyAffine(m, 3, 4), 3, 4);
    });

    it('composes the FK chain: rotating the root swings the child pivot', () => {
        const world = computeWorldMatrices(bones, { root: 90 });
        // Root rotates 90° about (0,0): the child's pivot (1,0) lands at (0,1).
        closeTo(applyAffine(world[1], 1, 0), 0, 1);
        // A point past the child pivot follows too.
        closeTo(applyAffine(world[1], 2, 0), 0, 2);
    });

    it('rotates a child about its own (parent-moved) pivot', () => {
        const world = computeWorldMatrices(bones, { root: 90, child: -90 });
        // Child pivot rides the root to (0,1); composing its own -90° about the
        // bind pivot under the root's 90° sends bind (2,0) → (1,-1) → (1,1).
        closeTo(applyAffine(world[1], 2, 0), 1, 1);
        closeTo(applyAffine(world[1], 1, 0), 0, 1);
    });
});

describe('skinVertices', () => {
    const bindWorld = computeWorldMatrices(bones, {});

    it('moves a fully-weighted vertex rigidly with its bone', () => {
        const mesh: SkinMesh = {
            vertices: [{ x: 2, y: 0, u: 0, v: 0, weights: [{ bone: 1, w: 1 }] }],
            triangles: [],
        };
        const out = skinVertices(mesh, bindWorld, computeWorldMatrices(bones, { root: 90 }));
        closeTo(out[0], 0, 2);
    });

    it('blends between bones by weight', () => {
        const mesh: SkinMesh = {
            vertices: [
                {
                    x: 2,
                    y: 0,
                    u: 0,
                    v: 0,
                    weights: [
                        { bone: 0, w: 0.5 },
                        { bone: 1, w: 0.5 },
                    ],
                },
            ],
            triangles: [],
        };
        // Only the child rotates (-90° about its pivot (1,0)): its transform
        // sends (2,0)→(1,-1), the root's identity holds (2,0); half-weight → midpoint.
        const out = skinVertices(mesh, bindWorld, computeWorldMatrices(bones, { child: -90 }));
        closeTo(out[0], 1.5, -0.5);
    });

    it('leaves an unweighted vertex at its bind position', () => {
        const mesh: SkinMesh = {
            vertices: [{ x: 5, y: 5, u: 0, v: 0, weights: [] }],
            triangles: [],
        };
        const out = skinVertices(mesh, bindWorld, computeWorldMatrices(bones, { root: 45, child: 45 }));
        closeTo(out[0], 5, 5);
    });
});

describe('invertAffine / composeAffine', () => {
    it('invertAffine inverts compose chains', () => {
        const world = computeWorldMatrices(bones, { root: 30, child: -15 });
        const inv = invertAffine(world[1]);
        const identity = composeAffine(world[1], inv);
        closeTo(applyAffine(identity, 7, -3), 7, -3);
    });
});

describe('triangleAffine', () => {
    it('maps each source corner exactly onto its destination corner', () => {
        const src: [[number, number], [number, number], [number, number]] = [
            [0, 0],
            [10, 0],
            [0, 5],
        ];
        const dst: [[number, number], [number, number], [number, number]] = [
            [3, 4],
            [3, 14],
            [13, 4],
        ];
        const m = triangleAffine(src, dst);
        expect(m).not.toBeNull();
        if (!m) return;
        src.forEach((s, i) => closeTo(applyAffine(m, s[0], s[1]), dst[i][0], dst[i][1]));
    });

    it('returns null for a degenerate (zero-area) source triangle', () => {
        const src: [[number, number], [number, number], [number, number]] = [
            [0, 0],
            [1, 1],
            [2, 2],
        ];
        const dst: [[number, number], [number, number], [number, number]] = [
            [0, 0],
            [1, 0],
            [0, 1],
        ];
        expect(triangleAffine(src, dst)).toBeNull();
    });
});

describe('vertexBounds', () => {
    it('bounds the points and returns null when empty', () => {
        expect(vertexBounds([])).toBeNull();
        expect(vertexBounds([[1, 2], [-3, 4], [0, -1]])).toEqual({ minX: -3, minY: -1, maxX: 1, maxY: 4 });
    });
});
