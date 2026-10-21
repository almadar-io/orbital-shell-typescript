'use client';
/**
 * PatternTile Atom
 *
 * Mathematically correct Islamic geometric pattern tiles using the
 * Polygons-in-Contact (PIC) method (Hankin 1925, formalized by Kaplan 2005).
 *
 * Construction: A regular polygon tiling is overlaid with star motifs.
 * Each motif touches the enclosing polygon at EDGE MIDPOINTS only.
 * Two rays emanate from each midpoint into the polygon at a specific
 * CONTACT ANGLE (theta). Where rays from adjacent midpoints intersect,
 * they form the star points. Gap tiles (squares, triangles) between
 * polygons receive inferred geometry by extending boundary rays inward.
 *
 * Variants:
 *   star8  — 8-fold star-and-cross on 4.8.8 tiling (theta = 67.5 deg)
 *   star6  — 6-fold star on hexagonal tiling (theta = 60 deg)
 *   khatam — 8-fold rosette with interlocking kites (theta = 72 deg)
 *   star10 — 10-fold girih on decagonal tiling (theta = 72 deg)
 *   star12 — 12-fold on dodecagonal tiling (theta = 75 deg)
 *
 * All tiles use stroke only (no fill), rendering as transparent overlays.
 */

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../lib/domPassthrough';
import React from 'react';

export type PatternVariant = 'star8' | 'star6' | 'khatam' | 'star10' | 'star12'
    | 'rosette-double' | 'rosette-filled'
    | 'seigaiha' | 'greek-key' | 'celtic-knot' | 'kolam'
    | 'arch' | 'arabesque-vine' | 'arabesque-net';

export interface PatternTileProps extends A11yProps {
    /** Which geometric pattern to render */
    variant?: PatternVariant;
    /** Tile unit size in SVG units */
    size?: number;
    /** Stroke color (CSS variable or hex) */
    color?: string;
    /** Line thickness */
    strokeWidth?: number;
    className?: string;
}

/* ── Math helpers ─────────────────────────────────────────────────────── */

const PI = Math.PI;

function lineIntersection(
    x1: number, y1: number, x2: number, y2: number,
    x3: number, y3: number, x4: number, y4: number,
): [number, number] {
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return [(x1 + x3) / 2, (y1 + y3) / 2];
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

function f(n: number): string {
    return n.toFixed(3);
}

/**
 * Generic PIC star construction for a regular n-gon.
 *
 * Given n vertices on a circle (flat-top orientation), computes:
 * 1. Edge midpoints
 * 2. Two rays from each midpoint at contact angle theta (rotated INWARD)
 * 3. Intersection of adjacent rays → inner star vertices
 * 4. Star path: midpoint → inner vertex → next midpoint (for each edge)
 *
 * Returns { starPath, mids, verts } for further decoration (connectors, etc.)
 */
function picStar(
    cx: number, cy: number, R: number, n: number, theta: number, extent: number,
): { starPath: string; mids: [number, number][]; verts: [number, number][] } {
    // Vertices: flat-top orientation, CLOCKWISE in SVG (y-down)
    const verts: [number, number][] = [];
    for (let k = 0; k < n; k++) {
        const angle = PI / n + k * (2 * PI) / n;
        verts.push([cx + R * Math.cos(angle), cy + R * Math.sin(angle)]);
    }

    // Edge midpoints
    const mids: [number, number][] = [];
    for (let k = 0; k < n; k++) {
        const next = (k + 1) % n;
        mids.push([(verts[k][0] + verts[next][0]) / 2, (verts[k][1] + verts[next][1]) / 2]);
    }

    // For clockwise vertices in SVG, the inward rotation from the edge
    // tangent is COUNTERCLOCKWISE (positive angle).
    // Ray from midpoint k "forward": rotate tangent by +theta
    // Ray from midpoint k+1 "backward": rotate tangent by +(PI - theta)
    const innerPts: [number, number][] = [];
    for (let k = 0; k < n; k++) {
        const next = (k + 1) % n;
        const M1 = mids[k];
        const M2 = mids[next];

        // Edge k tangent: vertex[k] → vertex[k+1]
        const edx1 = verts[(k + 1) % n][0] - verts[k][0];
        const edy1 = verts[(k + 1) % n][1] - verts[k][1];
        const elen1 = Math.sqrt(edx1 * edx1 + edy1 * edy1);
        const tx1 = edx1 / elen1;
        const ty1 = edy1 / elen1;

        // Forward ray from M1: rotate tangent by +theta (inward for CW vertices)
        const r1x = tx1 * Math.cos(theta) + ty1 * Math.sin(theta);
        const r1y = -tx1 * Math.sin(theta) + ty1 * Math.cos(theta);

        // Edge k+1 tangent: vertex[k+1] → vertex[k+2]
        const edx2 = verts[(next + 1) % n][0] - verts[next][0];
        const edy2 = verts[(next + 1) % n][1] - verts[next][1];
        const elen2 = Math.sqrt(edx2 * edx2 + edy2 * edy2);
        const tx2 = edx2 / elen2;
        const ty2 = edy2 / elen2;

        // Backward ray from M2: rotate tangent by +(PI - theta)
        const bTheta = PI - theta;
        const r2x = tx2 * Math.cos(bTheta) + ty2 * Math.sin(bTheta);
        const r2y = -tx2 * Math.sin(bTheta) + ty2 * Math.cos(bTheta);

        const P = lineIntersection(
            M1[0], M1[1], M1[0] + r1x * extent, M1[1] + r1y * extent,
            M2[0], M2[1], M2[0] + r2x * extent, M2[1] + r2y * extent,
        );
        innerPts.push(P);
    }

    // Star path: zigzag midpoint → inner → next midpoint
    const starPath = mids.map((m, k) => {
        const inner = innerPts[k];
        const nextMid = mids[(k + 1) % n];
        return `M ${f(m[0])},${f(m[1])} L ${f(inner[0])},${f(inner[1])} L ${f(nextMid[0])},${f(nextMid[1])}`;
    }).join(' ');

    return { starPath, mids, verts };
}

/* ── star8: 8-fold star-and-cross (4.8.8 tiling, theta=67.5) ─────────── */

function Star8({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const s = size;
    const cx = s / 2;
    const cy = s / 2;
    const a = s / (1 + Math.SQRT2);
    const R = a / (2 * Math.sin(PI / 8));
    const theta = (67.5 * PI) / 180;

    const { starPath, mids } = picStar(cx, cy, R, 8, theta, s);

    // Corner cross motifs (square gap inference)
    const corners: [number, number][] = [[0, 0], [s, 0], [s, s], [0, s]];
    const crossPaths: string[] = [];
    for (const [cornX, cornY] of corners) {
        const dists = mids.map((m, i) => ({ i, d: Math.hypot(m[0] - cornX, m[1] - cornY) }));
        dists.sort((a2, b) => a2.d - b.d);
        const m1 = mids[dists[0].i];
        const m2 = mids[dists[1].i];
        crossPaths.push(`M ${f(m1[0])},${f(m1[1])} L ${f(cornX)},${f(cornY)} L ${f(m2[0])},${f(m2[1])}`);
    }

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            <path d={starPath} />
            {crossPaths.map((d, i) => <path key={i} d={d} />)}
        </g>
    );
}

/* ── star6: 6-fold hexagram (hexagonal tiling, theta=60) ──────────────── */

function Star6({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const w = size;
    const h = size * (2 / Math.sqrt(3));
    const cx = w / 2;
    const cy = h / 2;
    const a = w / Math.sqrt(3);
    const R = a;
    const theta = (60 * PI) / 180;

    const { starPath, mids, verts } = picStar(cx, cy, R, 6, theta, w);

    // Triangle gap connectors at vertices
    const triPaths: string[] = [];
    for (let k = 0; k < 6; k++) {
        const v = verts[k];
        const m1 = mids[(k + 5) % 6];
        const m2 = mids[k];
        triPaths.push(`M ${f(m1[0])},${f(m1[1])} L ${f(v[0])},${f(v[1])} L ${f(m2[0])},${f(m2[1])}`);
    }

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            <path d={starPath} />
            {triPaths.map((d, i) => <path key={i} d={d} />)}
        </g>
    );
}

/* ── khatam: 8-fold rosette (4.8.8 tiling, theta=72) ─────────────────── */

function Khatam({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const s = size;
    const cx = s / 2;
    const cy = s / 2;
    const a = s / (1 + Math.SQRT2);
    const R = a / (2 * Math.sin(PI / 8));
    const theta = (72 * PI) / 180;

    const { starPath, mids } = picStar(cx, cy, R, 8, theta, s);

    // Corner cross motifs
    const corners: [number, number][] = [[0, 0], [s, 0], [s, s], [0, s]];
    const crossPaths: string[] = [];
    for (const [cornX, cornY] of corners) {
        const dists = mids.map((m, i) => ({ i, d: Math.hypot(m[0] - cornX, m[1] - cornY) }));
        dists.sort((a2, b) => a2.d - b.d);
        const m1 = mids[dists[0].i];
        const m2 = mids[dists[1].i];
        crossPaths.push(`M ${f(m1[0])},${f(m1[1])} L ${f(cornX)},${f(cornY)} L ${f(m2[0])},${f(m2[1])}`);
    }

    const orbitR = R * 0.35;

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            <path d={starPath} />
            {crossPaths.map((d, i) => <path key={i} d={d} />)}
            <circle cx={cx} cy={cy} r={orbitR} opacity="0.4" />
        </g>
    );
}

/* ── rosette-double: nested khatam at two radii ───────────────────────
 *
 * Two concentric 8-fold rosettes (outer theta=72, inner theta=68)
 * creating a layered mandala. The inner star sits inside the outer
 * star's central void, with connecting lines between layers.
 */
function RosetteDouble({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const s = size;
    const cx = s / 2;
    const cy = s / 2;
    const a = s / (1 + Math.SQRT2);
    const Router = a / (2 * Math.sin(PI / 8));
    const Rinner = Router * 0.45;

    // Outer rosette (theta=72)
    const outer = picStar(cx, cy, Router, 8, (72 * PI) / 180, s);

    // Inner rosette (theta=68, tighter points)
    const inner = picStar(cx, cy, Rinner, 8, (68 * PI) / 180, s);

    // Corner cross motifs (from outer)
    const corners: [number, number][] = [[0, 0], [s, 0], [s, s], [0, s]];
    const crossPaths: string[] = [];
    for (const [cornX, cornY] of corners) {
        const dists = outer.mids.map((m, i) => ({ i, d: Math.hypot(m[0] - cornX, m[1] - cornY) }));
        dists.sort((a2, b) => a2.d - b.d);
        const m1 = outer.mids[dists[0].i];
        const m2 = outer.mids[dists[1].i];
        crossPaths.push(`M ${f(m1[0])},${f(m1[1])} L ${f(cornX)},${f(cornY)} L ${f(m2[0])},${f(m2[1])}`);
    }

    // Connecting lines: inner midpoints to outer midpoints
    const connectors: string[] = [];
    for (let k = 0; k < 8; k++) {
        const om = outer.mids[k];
        const im = inner.mids[k];
        connectors.push(`M ${f(im[0])},${f(im[1])} L ${f(om[0])},${f(om[1])}`);
    }

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            <path d={outer.starPath} />
            <path d={inner.starPath} opacity="0.7" />
            {crossPaths.map((d, i) => <path key={`c${i}`} d={d} />)}
            {connectors.map((d, i) => <path key={`n${i}`} d={d} opacity="0.4" />)}
        </g>
    );
}

/* ── rosette-filled: khatam with inner star6 fill ─────────────────────
 *
 * Outer 8-fold rosette (theta=72) with a 6-fold star pattern
 * filling the central void. Creates a rich, dense pattern with
 * two symmetry systems layered together.
 */
function RosetteFilled({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const s = size;
    const cx = s / 2;
    const cy = s / 2;
    const a = s / (1 + Math.SQRT2);
    const Router = a / (2 * Math.sin(PI / 8));
    const theta = (72 * PI) / 180;

    // Outer rosette
    const outer = picStar(cx, cy, Router, 8, theta, s);

    // Inner 6-fold star filling the center
    const Rinner = Router * 0.35;
    const inner6 = picStar(cx, cy, Rinner, 6, (60 * PI) / 180, s);

    // Corner cross motifs
    const corners: [number, number][] = [[0, 0], [s, 0], [s, s], [0, s]];
    const crossPaths: string[] = [];
    for (const [cornX, cornY] of corners) {
        const dists = outer.mids.map((m, i) => ({ i, d: Math.hypot(m[0] - cornX, m[1] - cornY) }));
        dists.sort((a2, b) => a2.d - b.d);
        const m1 = outer.mids[dists[0].i];
        const m2 = outer.mids[dists[1].i];
        crossPaths.push(`M ${f(m1[0])},${f(m1[1])} L ${f(cornX)},${f(cornY)} L ${f(m2[0])},${f(m2[1])}`);
    }

    // Inner 6 triangle gap connectors
    const triPaths: string[] = [];
    for (let k = 0; k < 6; k++) {
        const v = inner6.verts[k];
        const m1 = inner6.mids[(k + 5) % 6];
        const m2 = inner6.mids[k];
        triPaths.push(`M ${f(m1[0])},${f(m1[1])} L ${f(v[0])},${f(v[1])} L ${f(m2[0])},${f(m2[1])}`);
    }

    const orbitR = Router * 0.35;

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            <path d={outer.starPath} />
            {crossPaths.map((d, i) => <path key={`c${i}`} d={d} />)}
            <circle cx={cx} cy={cy} r={orbitR} opacity="0.3" />
            <path d={inner6.starPath} opacity="0.6" />
            {triPaths.map((d, i) => <path key={`t${i}`} d={d} opacity="0.5" />)}
        </g>
    );
}

/* ── star10: 10-fold girih (decagonal, theta=72) ──────────────────────── */

function Star10({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const s = size;
    const cx = s / 2;
    const cy = s / 2;
    const R = s * 0.42;
    const theta = (72 * PI) / 180;

    const { starPath, mids, verts } = picStar(cx, cy, R, 10, theta, s);

    // Pentagon gap connectors at vertices
    const edgePaths: string[] = [];
    for (let k = 0; k < 10; k++) {
        const v = verts[k];
        const m1 = mids[(k + 9) % 10];
        const m2 = mids[k];
        edgePaths.push(`M ${f(m1[0])},${f(m1[1])} L ${f(v[0])},${f(v[1])} L ${f(m2[0])},${f(m2[1])}`);
    }

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            <path d={starPath} />
            {edgePaths.map((d, i) => <path key={i} d={d} />)}
        </g>
    );
}

/* ── star12: 12-fold dodecagonal (3.12.12 tiling, theta=75) ───────────── */

function Star12({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const s = size;
    const cx = s / 2;
    const cy = s / 2;
    const R = s * 0.44;
    const theta = (75 * PI) / 180;

    const { starPath, mids, verts } = picStar(cx, cy, R, 12, theta, s);

    // Triangle gap connectors at vertices
    const triPaths: string[] = [];
    for (let k = 0; k < 12; k++) {
        const v = verts[k];
        const m1 = mids[(k + 11) % 12];
        const m2 = mids[k];
        triPaths.push(`M ${f(m1[0])},${f(m1[1])} L ${f(v[0])},${f(v[1])} L ${f(m2[0])},${f(m2[1])}`);
    }

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            <path d={starPath} />
            {triPaths.map((d, i) => <path key={i} d={d} />)}
        </g>
    );
}

/* ═══════════════════════════════════════════════════════════════════════
 * CROSS-CULTURAL PATTERNS
 * ═══════════════════════════════════════════════════════════════════════ */

/* ── seigaiha: Japanese wave/scale ────────────────────────────────────
 *
 * Overlapping concentric semicircles arranged in a fish-scale pattern.
 * Each cell has 3 concentric arcs. Cells are staggered in a brick-like
 * arrangement. Construction: circular arcs on an offset grid.
 */
function Seigaiha({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const s = size;
    const r = s / 2;
    const paths: string[] = [];

    // Two scale positions: top-center and bottom offset
    const centers: [number, number][] = [
        [s / 2, s * 0.6],
        [0, s * 0.1],
        [s, s * 0.1],
    ];

    for (const [cx, cy] of centers) {
        // 3 concentric semicircular arcs (opening upward)
        for (let ring = 1; ring <= 3; ring++) {
            const cr = r * (ring / 3);
            // Arc from left to right (semicircle opening upward)
            paths.push(
                `M ${f(cx - cr)},${f(cy)} A ${f(cr)} ${f(cr)} 0 0 1 ${f(cx + cr)},${f(cy)}`,
            );
        }
    }

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            {paths.map((d, i) => <path key={i} d={d} />)}
        </g>
    );
}

/* ── greek-key: Meander / angular spiral ──────────────────────────────
 *
 * Continuous angular spiral that reverses direction at each tile boundary.
 * The meander is built on a sub-grid (4x4 within each tile).
 * Construction: L-shaped paths that spiral inward on a grid, connecting
 * at tile edges for a continuous band.
 */
function GreekKey({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const s = size;
    const u = s / 4; // grid unit

    // Single meander unit: an angular spiral that enters from top-left,
    // spirals inward clockwise, then exits at top-right.
    const paths: string[] = [
        // Outer frame
        `M 0,0 L ${f(s)},0`,
        `M 0,${f(s)} L ${f(s)},${f(s)}`,
        // Spiral from left
        `M 0,${f(u)} L ${f(3 * u)},${f(u)} L ${f(3 * u)},${f(3 * u)} L ${f(u)},${f(3 * u)} L ${f(u)},${f(2 * u)} L ${f(2 * u)},${f(2 * u)}`,
        // Spiral from right (mirrored, offset)
        `M ${f(s)},${f(3 * u)} L ${f(s - 3 * u)},${f(3 * u)} L ${f(s - 3 * u)},${f(u)} L ${f(s - u)},${f(u)} L ${f(s - u)},${f(2 * u)} L ${f(s - 2 * u)},${f(2 * u)}`,
        // Vertical connectors at edges
        `M 0,0 L 0,${f(u)}`,
        `M ${f(s)},0 L ${f(s)},${f(u)}`,
        `M 0,${f(3 * u)} L 0,${f(s)}`,
        `M ${f(s)},${f(3 * u)} L ${f(s)},${f(s)}`,
    ];

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            {paths.map((d, i) => <path key={i} d={d} />)}
        </g>
    );
}

/* ── celtic-knot: Interlacing bands ───────────────────────────────────
 *
 * Continuous band that weaves over and under itself in a figure-eight
 * pattern. The basic knot unit is a 4-crossing plait that tiles
 * seamlessly. Construction: curved paths on a diagonal grid with
 * alternating over-under breaks at crossings.
 */
function CelticKnot({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const s = size;
    const q = s / 4;

    // Two interlacing diagonal bands, each making smooth S-curves
    // Band 1: top-left to bottom-right, curving through the tile
    // Band 2: top-right to bottom-left, crossing Band 1
    const r = q * 0.9; // curve radius

    const paths: string[] = [
        // Band 1: diagonal with curves at crossings
        `M 0,0 Q ${f(q)},${f(q)} ${f(2 * q)},${f(2 * q)}`,
        `M ${f(2 * q)},${f(2 * q)} Q ${f(3 * q)},${f(3 * q)} ${f(s)},${f(s)}`,
        // Band 2: other diagonal
        `M ${f(s)},0 Q ${f(3 * q)},${f(q)} ${f(2 * q)},${f(2 * q)}`,
        `M ${f(2 * q)},${f(2 * q)} Q ${f(q)},${f(3 * q)} 0,${f(s)}`,
        // Outer loops that connect bands at tile edges for continuous weave
        `M 0,0 Q ${f(-q * 0.3)},${f(2 * q)} 0,${f(s)}`,
        `M ${f(s)},0 Q ${f(s + q * 0.3)},${f(2 * q)} ${f(s)},${f(s)}`,
        `M 0,0 Q ${f(2 * q)},${f(-q * 0.3)} ${f(s)},0`,
        `M 0,${f(s)} Q ${f(2 * q)},${f(s + q * 0.3)} ${f(s)},${f(s)}`,
        // Inner circle at crossing
        `M ${f(2 * q + r * 0.3)},${f(2 * q)} A ${f(r * 0.3)} ${f(r * 0.3)} 0 1 1 ${f(2 * q + r * 0.3)},${f(2 * q + 0.001)}`,
    ];

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            {paths.map((d, i) => <path key={i} d={d} />)}
        </g>
    );
}

/* ── kolam: South Indian dot-grid looping pattern ─────────────────────
 *
 * Continuous curved line that loops around dots arranged on a grid.
 * The line never crosses itself, creating an elegant single-stroke
 * design. Construction: smooth curves (cubic beziers) weaving around
 * a 3x3 dot grid within each tile.
 */
function Kolam({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const s = size;
    const u = s / 4; // grid spacing
    const dotR = s * 0.015;

    // 3x3 dot grid (offset by u from edges)
    const dots: [number, number][] = [];
    for (let row = 1; row <= 3; row++) {
        for (let col = 1; col <= 3; col++) {
            dots.push([col * u, row * u]);
        }
    }

    // Looping curves around the dots
    // The curves form petal-like loops around each dot
    const curves: string[] = [];

    // Horizontal loops between adjacent dots
    for (let row = 1; row <= 3; row++) {
        const y = row * u;
        for (let col = 1; col < 3; col++) {
            const x1 = col * u;
            const x2 = (col + 1) * u;
            const mx = (x1 + x2) / 2;
            const bulge = u * 0.4;
            curves.push(`M ${f(x1)},${f(y)} C ${f(mx)},${f(y - bulge)} ${f(mx)},${f(y - bulge)} ${f(x2)},${f(y)}`);
            curves.push(`M ${f(x1)},${f(y)} C ${f(mx)},${f(y + bulge)} ${f(mx)},${f(y + bulge)} ${f(x2)},${f(y)}`);
        }
    }

    // Vertical loops between adjacent dots
    for (let col = 1; col <= 3; col++) {
        const x = col * u;
        for (let row = 1; row < 3; row++) {
            const y1 = row * u;
            const y2 = (row + 1) * u;
            const my = (y1 + y2) / 2;
            const bulge = u * 0.4;
            curves.push(`M ${f(x)},${f(y1)} C ${f(x - bulge)},${f(my)} ${f(x - bulge)},${f(my)} ${f(x)},${f(y2)}`);
            curves.push(`M ${f(x)},${f(y1)} C ${f(x + bulge)},${f(my)} ${f(x + bulge)},${f(my)} ${f(x)},${f(y2)}`);
        }
    }

    // Edge connectors for seamless tiling
    for (let k = 1; k <= 3; k++) {
        curves.push(`M ${f(k * u)},${f(u)} C ${f(k * u)},${f(u * 0.5)} ${f(k * u)},${f(u * 0.5)} ${f(k * u)},0`);
        curves.push(`M ${f(k * u)},${f(3 * u)} C ${f(k * u)},${f(3.5 * u)} ${f(k * u)},${f(3.5 * u)} ${f(k * u)},${f(s)}`);
        curves.push(`M ${f(u)},${f(k * u)} C ${f(u * 0.5)},${f(k * u)} ${f(u * 0.5)},${f(k * u)} 0,${f(k * u)}`);
        curves.push(`M ${f(3 * u)},${f(k * u)} C ${f(3.5 * u)},${f(k * u)} ${f(3.5 * u)},${f(k * u)} ${f(s)},${f(k * u)}`);
    }

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            {curves.map((d, i) => <path key={`c${i}`} d={d} />)}
            {dots.map(([x, y], i) => <circle key={`d${i}`} cx={x} cy={y} r={dotR} fill={color} opacity="0.5" />)}
        </g>
    );
}

/* ═══════════════════════════════════════════════════════════════════════
 * ARABESQUE EDGE PATTERNS
 *
 * These are NOT tiling fills. They are edge/border decorations inspired
 * by Islamic architectural elements: mihrab arches, vine scrollwork,
 * and lattice screens. Designed to sit on section edges, they tile
 * vertically (repeating down the side) rather than in 2D.
 * ═══════════════════════════════════════════════════════════════════════ */

/* ── arch: Concentric mihrab arches ───────────────────────────────────
 *
 * Stacked nested pointed arches (ogee/mihrab shape) that repeat
 * vertically. Each unit has 3-4 concentric arches of decreasing size.
 * The pointed arch is constructed from two circular arcs meeting at
 * a point at the top, matching the Islamic pointed arch (lancet)
 * proportions where the arc centers are offset outward.
 *
 * The tile is tall (height = 1.5 * width) to give the arch proper
 * vertical proportions.
 */
function Arch({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const w = size;
    const h = size * 1.5;
    const cx = w / 2;
    const paths: string[] = [];

    // 4 concentric pointed arches, each smaller than the last
    for (let ring = 0; ring < 4; ring++) {
        const scale = 1 - ring * 0.2;
        const archW = (w * 0.48) * scale; // half-width of arch at base
        const archH = (h * 0.7) * scale;  // height of arch from base to tip
        const baseY = h * 0.85;           // base of all arches
        const tipY = baseY - archH;       // top point

        // Pointed arch: two arcs meeting at (cx, tipY)
        // Left arc center is offset right of left base, right arc offset left of right base
        // This creates the characteristic Islamic pointed arch
        const lx = cx - archW;
        const rx = cx + archW;

        // Arc radius: distance from arc center to the tip
        // Arc centers are at (cx ± offset, baseY) where offset < archW
        const offset = archW * 0.3; // controls pointedness (smaller = more pointed)
        const lcx = lx + offset;
        const rcx = rx - offset;

        // Radius from left center to tip
        const rdx = cx - lcx;
        const rdy = baseY - tipY;
        const radius = Math.sqrt(rdx * rdx + rdy * rdy);

        // SVG arc: from base point, arc to tip, then arc to other base point
        paths.push(
            `M ${f(lx)},${f(baseY)} A ${f(radius)} ${f(radius)} 0 0 1 ${f(cx)},${f(tipY)} A ${f(radius)} ${f(radius)} 0 0 1 ${f(rx)},${f(baseY)}`,
        );

        // Connecting horizontal line at base
        if (ring === 0) {
            paths.push(`M ${f(lx)},${f(baseY)} L ${f(rx)},${f(baseY)}`);
        }
    }

    // Decorative keyhole circle at the center of the innermost arch
    const innerScale = 1 - 3 * 0.2;
    const keyR = w * 0.48 * innerScale * 0.35;
    const keyY = h * 0.85 - h * 0.7 * innerScale * 0.4;
    paths.push(
        `M ${f(cx + keyR)},${f(keyY)} A ${f(keyR)} ${f(keyR)} 0 1 1 ${f(cx + keyR)},${f(keyY + 0.001)}`,
    );

    // Small spandrel arcs in the corners above the outer arch
    const spR = w * 0.15;
    paths.push(`M 0,0 A ${f(spR)} ${f(spR)} 0 0 0 ${f(spR)},${f(spR)}`);
    paths.push(`M ${f(w)},0 A ${f(spR)} ${f(spR)} 0 0 1 ${f(w - spR)},${f(spR)}`);

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            {paths.map((d, i) => <path key={i} d={d} />)}
        </g>
    );
}

/* ── arabesque-vine: Flowing scroll/tendril pattern ───────────────────
 *
 * Continuous S-curves that branch and reconnect, inspired by Islamic
 * illumination vine scrollwork (tawriq/islimi). The main stem follows
 * a sinusoidal path, with secondary curling tendrils branching off
 * at regular intervals. Leaf-shaped loops form at branch points.
 *
 * Construction: cubic bezier curves along a sine wave backbone,
 * with smaller bezier branches. Tiles vertically.
 */
function ArabesqueVine({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const w = size;
    const h = size * 1.2;
    const cx = w / 2;
    const paths: string[] = [];

    // Main S-curve stem (sinusoidal backbone)
    const amp = w * 0.3; // horizontal amplitude
    const segments = 3;
    const segH = h / segments;

    for (let i = 0; i < segments; i++) {
        const y0 = i * segH;
        const y1 = y0 + segH;
        const dir = i % 2 === 0 ? 1 : -1;

        // S-curve segment using cubic bezier
        paths.push(
            `M ${f(cx)},${f(y0)} C ${f(cx + amp * dir)},${f(y0 + segH * 0.33)} ${f(cx - amp * dir)},${f(y0 + segH * 0.66)} ${f(cx)},${f(y1)}`,
        );

        // Branch tendrils at the inflection point
        const branchY = y0 + segH * 0.5;
        const branchX = cx + amp * dir * 0.15;
        const tendrilLen = w * 0.25;

        // Left tendril: curling leaf loop
        const tlx = branchX - tendrilLen;
        const tly = branchY - tendrilLen * 0.4;
        paths.push(
            `M ${f(branchX)},${f(branchY)} C ${f(branchX - tendrilLen * 0.5)},${f(branchY - tendrilLen * 0.8)} ${f(tlx - tendrilLen * 0.2)},${f(tly + tendrilLen * 0.3)} ${f(tlx)},${f(tly)}`,
        );
        // Return curve (completes the leaf)
        paths.push(
            `M ${f(tlx)},${f(tly)} C ${f(tlx + tendrilLen * 0.3)},${f(tly + tendrilLen * 0.5)} ${f(branchX - tendrilLen * 0.2)},${f(branchY + tendrilLen * 0.3)} ${f(branchX)},${f(branchY)}`,
        );

        // Right tendril: mirror
        const trx = branchX + tendrilLen;
        const try_ = branchY + tendrilLen * 0.4;
        paths.push(
            `M ${f(branchX)},${f(branchY)} C ${f(branchX + tendrilLen * 0.5)},${f(branchY + tendrilLen * 0.8)} ${f(trx + tendrilLen * 0.2)},${f(try_ - tendrilLen * 0.3)} ${f(trx)},${f(try_)}`,
        );
        paths.push(
            `M ${f(trx)},${f(try_)} C ${f(trx - tendrilLen * 0.3)},${f(try_ - tendrilLen * 0.5)} ${f(branchX + tendrilLen * 0.2)},${f(branchY - tendrilLen * 0.3)} ${f(branchX)},${f(branchY)}`,
        );

        // Small spiral at each branch tip
        const spiralR = tendrilLen * 0.15;
        paths.push(
            `M ${f(tlx)},${f(tly)} A ${f(spiralR)} ${f(spiralR)} 0 1 0 ${f(tlx + spiralR * 2)},${f(tly)}`,
        );
        paths.push(
            `M ${f(trx)},${f(try_)} A ${f(spiralR)} ${f(spiralR)} 0 1 1 ${f(trx - spiralR * 2)},${f(try_)}`,
        );
    }

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            {paths.map((d, i) => <path key={i} d={d} />)}
        </g>
    );
}

/* ── arabesque-net: Fine interlocking lattice ─────────────────────────
 *
 * Dense lattice of interlocking curved diamonds, inspired by mashrabiya
 * (wooden lattice screens). Each cell is a small diamond shape formed
 * by 4 arcs. The arcs from adjacent cells share endpoints, creating
 * a continuous woven mesh. Denser than the star patterns, suitable
 * for subtle background texture.
 *
 * Construction: overlapping arc pairs on a diagonal grid.
 */
function ArabesqueNet({ size, color, strokeWidth }: { size: number; color: string; strokeWidth: number }) {
    const s = size;
    const cells = 4; // 4x4 cells per tile
    const cellW = s / cells;
    const cellH = s / cells;
    const paths: string[] = [];

    for (let row = 0; row < cells; row++) {
        for (let col = 0; col < cells; col++) {
            const cx = col * cellW + cellW / 2;
            const cy = row * cellH + cellH / 2;
            const hw = cellW * 0.5; // half-width
            const hh = cellH * 0.5;
            const bulge = cellW * 0.25; // arc curvature

            // Diamond from 4 arcs: top→right→bottom→left→top
            // Top to right
            paths.push(
                `M ${f(cx)},${f(cy - hh)} Q ${f(cx + bulge)},${f(cy - bulge)} ${f(cx + hw)},${f(cy)}`,
            );
            // Right to bottom
            paths.push(
                `M ${f(cx + hw)},${f(cy)} Q ${f(cx + bulge)},${f(cy + bulge)} ${f(cx)},${f(cy + hh)}`,
            );
            // Bottom to left
            paths.push(
                `M ${f(cx)},${f(cy + hh)} Q ${f(cx - bulge)},${f(cy + bulge)} ${f(cx - hw)},${f(cy)}`,
            );
            // Left to top
            paths.push(
                `M ${f(cx - hw)},${f(cy)} Q ${f(cx - bulge)},${f(cy - bulge)} ${f(cx)},${f(cy - hh)}`,
            );
        }
    }

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            {paths.map((d, i) => <path key={i} d={d} />)}
        </g>
    );
}

/* ── PatternTile ──────────────────────────────────────────────────────── */

const VARIANT_MAP = {
    'star8': Star8,
    'star6': Star6,
    'khatam': Khatam,
    'star10': Star10,
    'star12': Star12,
    'rosette-double': RosetteDouble,
    'rosette-filled': RosetteFilled,
    'seigaiha': Seigaiha,
    'greek-key': GreekKey,
    'celtic-knot': CelticKnot,
    'kolam': Kolam,
    'arch': Arch,
    'arabesque-vine': ArabesqueVine,
    'arabesque-net': ArabesqueNet,
} as const;

export const PatternTile: React.FC<PatternTileProps> = ({
    variant = 'star8',
    size = 60,
    color = 'var(--color-primary)',
    strokeWidth = 0.5,
    className,
    ...rest
}) => {
    const Variant = VARIANT_MAP[variant];
    return (
        <g className={className} {...domPassthrough(rest)}>
            <Variant size={size} color={color} strokeWidth={strokeWidth} />
        </g>
    );
};

PatternTile.displayName = 'PatternTile';

/** Returns the tile dimensions for a given variant and size */
export function getTileDimensions(variant: PatternVariant, size: number): { width: number; height: number } {
    if (variant === 'star6') {
        return { width: size, height: size * (2 / Math.sqrt(3)) };
    }
    if (variant === 'arch') {
        return { width: size, height: size * 1.5 };
    }
    if (variant === 'arabesque-vine') {
        return { width: size, height: size * 1.2 };
    }
    return { width: size, height: size };
}
