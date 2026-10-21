'use client';
/**
 * EdgeDecoration Molecule
 *
 * Standalone SVG decorative elements positioned on section edges.
 * Unlike GeometricPattern (which tiles small units), these are large
 * singular shapes placed at specific positions: left edge, right edge,
 * or both.
 *
 * Variants:
 *   arch       — Concentric pointed mihrab arches (half-circles opening inward)
 *   vine       — Flowing arabesque scroll tendrils running vertically
 *   lattice    — Fine curved diamond lattice mesh
 *
 * Each variant renders as an absolutely-positioned SVG on one or both
 * sides of the parent container.
 */

import React, { useId } from 'react';
import { cn } from '../../../core';
import type { ColorToken } from '../../../core';

export type EdgeVariant = 'arch' | 'vine' | 'lattice';
export type EdgeSide = 'left' | 'right' | 'both';

const colorTokenVars: Record<ColorToken, string> = {
  primary: 'var(--color-primary)',
  secondary: 'var(--color-secondary)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  muted: 'var(--color-muted)',
};

export interface EdgeDecorationProps {
    /** Which decorative element */
    variant?: EdgeVariant;
    /** Which side(s) to place the decoration */
    side?: EdgeSide;
    /** Overall opacity (default: 0.15) */
    opacity?: number;
    /** Semantic palette token or a raw CSS color value for the stroke. */
    color?: ColorToken | string;
    /** Stroke width */
    strokeWidth?: number;
    /** Width of the decoration area as percentage of container (default: 15) */
    width?: number;
    className?: string;
}

/* ── Arch: Concentric mihrab half-arches ──────────────────────────────
 *
 * Multiple nested pointed arches stacked vertically along the edge.
 * Each arch is a half-arch: the open side faces inward toward content.
 * Built from circular arc segments meeting at pointed tips.
 */
function ArchSVG({
    facing, w, h, color, strokeWidth,
}: {
    facing: 'left' | 'right';
    w: number;
    h: number;
    color: string;
    strokeWidth: number;
}) {
    const paths: string[] = [];
    const archCount = 3; // number of arch groups stacked vertically
    const archH = h / archCount;
    const rings = 5; // concentric arches per group

    for (let a = 0; a < archCount; a++) {
        const baseY = a * archH + archH; // bottom of this arch
        const topY = a * archH + archH * 0.05; // top point

        for (let r = 0; r < rings; r++) {
            const scale = 1 - r * 0.17;
            const archW = w * 0.95 * scale;
            const aTopY = topY + (1 - scale) * (baseY - topY) * 0.5;
            const aBaseY = baseY - (1 - scale) * archH * 0.05;

            // The arch edge: for 'right' facing, arch sits on right edge opening left
            // for 'left' facing, arch sits on left edge opening right
            const edgeX = facing === 'right' ? w : 0;
            const innerX = facing === 'right' ? w - archW : archW;

            // Pointed arch using two arcs
            const midY = (aTopY + aBaseY) / 2;
            const radius = Math.sqrt(archW * archW + (aBaseY - midY) * (aBaseY - midY));

            // Arc from base up to tip, then back down to base
            // The tip is at the inner edge, base points are at the outer edge
            if (facing === 'right') {
                paths.push(
                    `M ${f(edgeX)},${f(aBaseY)} A ${f(radius)} ${f(radius)} 0 0 0 ${f(innerX)},${f(aTopY + (aBaseY - aTopY) * 0.5)} A ${f(radius)} ${f(radius)} 0 0 0 ${f(edgeX)},${f(aTopY)}`,
                );
            } else {
                paths.push(
                    `M ${f(edgeX)},${f(aBaseY)} A ${f(radius)} ${f(radius)} 0 0 1 ${f(innerX)},${f(aTopY + (aBaseY - aTopY) * 0.5)} A ${f(radius)} ${f(radius)} 0 0 1 ${f(edgeX)},${f(aTopY)}`,
                );
            }
        }

        // Horizontal base line
        const edgeX = facing === 'right' ? w : 0;
        const innerX = facing === 'right' ? w * 0.05 : w * 0.95;
        paths.push(`M ${f(edgeX)},${f(baseY)} L ${f(innerX)},${f(baseY)}`);
    }

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            {paths.map((d, i) => <path key={i} d={d} />)}
        </g>
    );
}

/* ── Vine: Flowing arabesque scroll ───────────────────────────────────
 *
 * S-curve stem running vertically along the edge with branching
 * leaf-shaped loops curling inward. The vine hugs the edge and
 * its tendrils reach toward the content area.
 */
function VineSVG({
    facing, w, h, color, strokeWidth,
}: {
    facing: 'left' | 'right';
    w: number;
    h: number;
    color: string;
    strokeWidth: number;
}) {
    const paths: string[] = [];
    const dir = facing === 'right' ? -1 : 1; // tendrils grow inward
    const edgeX = facing === 'right' ? w * 0.85 : w * 0.15;
    const segments = 5;
    const segH = h / segments;

    for (let i = 0; i < segments; i++) {
        const y0 = i * segH;
        const y1 = y0 + segH;
        const sway = w * 0.12 * (i % 2 === 0 ? 1 : -1);

        // Main stem S-curve
        paths.push(
            `M ${f(edgeX + sway)},${f(y0)} C ${f(edgeX - sway)},${f(y0 + segH * 0.33)} ${f(edgeX + sway)},${f(y0 + segH * 0.66)} ${f(edgeX - sway)},${f(y1)}`,
        );

        // Leaf loop branching inward
        const branchY = y0 + segH * 0.35;
        const branchX = edgeX;
        const leafW = w * 0.55;
        const leafH = segH * 0.35;
        const leafTipX = branchX + dir * leafW;
        const leafTipY = branchY - leafH * 0.2;

        // Outward curve
        paths.push(
            `M ${f(branchX)},${f(branchY)} C ${f(branchX + dir * leafW * 0.3)},${f(branchY - leafH)} ${f(leafTipX - dir * leafW * 0.1)},${f(leafTipY - leafH * 0.3)} ${f(leafTipX)},${f(leafTipY)}`,
        );
        // Return curve (completes the leaf)
        paths.push(
            `M ${f(leafTipX)},${f(leafTipY)} C ${f(leafTipX - dir * leafW * 0.2)},${f(leafTipY + leafH * 0.6)} ${f(branchX + dir * leafW * 0.15)},${f(branchY + leafH * 0.4)} ${f(branchX)},${f(branchY + leafH * 0.1)}`,
        );

        // Smaller secondary tendril
        const tendrilY = y0 + segH * 0.7;
        const tendrilW = w * 0.35;
        const tendrilTipX = edgeX + dir * tendrilW;
        paths.push(
            `M ${f(edgeX)},${f(tendrilY)} Q ${f(edgeX + dir * tendrilW * 0.6)},${f(tendrilY - segH * 0.12)} ${f(tendrilTipX)},${f(tendrilY + segH * 0.05)}`,
        );

        // Spiral at leaf tip
        const spR = leafW * 0.08;
        paths.push(
            `M ${f(leafTipX)},${f(leafTipY)} A ${f(spR)} ${f(spR)} 0 1 ${facing === 'right' ? 0 : 1} ${f(leafTipX + dir * spR * 0.5)},${f(leafTipY + spR)}`,
        );
    }

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            {paths.map((d, i) => <path key={i} d={d} />)}
        </g>
    );
}

/* ── Lattice: Fine curved diamond mesh ────────────────────────────────
 *
 * Dense grid of curved diamond shapes that gets sparser toward the
 * content area (gradient density). Like a mashrabiya screen that
 * dissolves into the page.
 */
function LatticeSVG({
    facing, w, h, color, strokeWidth,
}: {
    facing: 'left' | 'right';
    w: number;
    h: number;
    color: string;
    strokeWidth: number;
}) {
    const paths: string[] = [];
    const cols = 5;
    const rows = Math.ceil(h / (w / cols));
    const cellW = w / cols;
    const cellH = cellW;
    const bulge = cellW * 0.3;

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            // Fade opacity based on distance from edge
            const distFromEdge = facing === 'right' ? cols - col : col;
            const cellOpacity = Math.max(0.1, 1 - distFromEdge * 0.22);

            const cx = col * cellW + cellW / 2;
            const cy = row * cellH + cellH / 2;
            const hw = cellW * 0.5;
            const hh = cellH * 0.5;

            // 4 curved sides of diamond
            paths.push(
                `M ${f(cx)},${f(cy - hh)} Q ${f(cx + bulge)},${f(cy)} ${f(cx)},${f(cy + hh)}`,
            );
            paths.push(
                `M ${f(cx)},${f(cy - hh)} Q ${f(cx - bulge)},${f(cy)} ${f(cx)},${f(cy + hh)}`,
            );
            // Horizontal connecting arcs
            paths.push(
                `M ${f(cx - hw)},${f(cy)} Q ${f(cx)},${f(cy - bulge * 0.5)} ${f(cx + hw)},${f(cy)}`,
            );
            paths.push(
                `M ${f(cx - hw)},${f(cy)} Q ${f(cx)},${f(cy + bulge * 0.5)} ${f(cx + hw)},${f(cy)}`,
            );

            // Apply per-cell opacity via a group
            // We mark these paths with data for potential future use
            void cellOpacity; // opacity handled at group level for now
        }
    }

    return (
        <g fill="none" stroke={color} strokeWidth={strokeWidth}>
            {paths.map((d, i) => <path key={i} d={d} />)}
        </g>
    );
}

/* ── Helper: format number ────────────────────────────────────────────── */
function f(n: number): string {
    return n.toFixed(2);
}

/* ── Main Component ───────────────────────────────────────────────────── */

const VARIANT_MAP = {
    arch: ArchSVG,
    vine: VineSVG,
    lattice: LatticeSVG,
} as const;

export const EdgeDecoration: React.FC<EdgeDecorationProps> = ({
    variant = 'arch',
    side = 'both',
    opacity = 0.15,
    color = 'primary',
    strokeWidth = 0.5,
    width = 15,
    className,
}) => {
    const id = useId();
    const Variant = VARIANT_MAP[variant];
    const resolvedColor = color in colorTokenVars
        ? colorTokenVars[color as ColorToken]
        : color;

    const sides: ('left' | 'right')[] =
        side === 'both' ? ['left', 'right'] : [side];

    return (
        <>
            {sides.map((s) => (
                <svg
                    key={`${id}-${s}`}
                    className={cn(
                        'absolute top-0 h-full pointer-events-none',
                        s === 'left' ? 'left-0' : 'right-0',
                        className,
                    )}
                    style={{
                        width: `${width}%`,
                        opacity,
                    }}
                    viewBox={`0 0 200 ${200 * 3}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    <Variant
                        facing={s}
                        w={200}
                        h={600}
                        color={resolvedColor}
                        strokeWidth={strokeWidth}
                    />
                </svg>
            ))}
        </>
    );
};

EdgeDecoration.displayName = 'EdgeDecoration';
