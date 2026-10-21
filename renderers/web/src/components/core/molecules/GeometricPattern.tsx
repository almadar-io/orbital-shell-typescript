'use client';
/**
 * GeometricPattern Molecule
 *
 * Composes PatternTile into reusable layout modes for Islamic geometric
 * background decoration. Supports four modes:
 *
 *   background — full tiling fill behind content
 *   left/right — pattern fades from one side toward the other
 *   frame      — thin decorative strips above and below content
 *
 * Uses SVG <pattern> for efficient tiling and <mask> for fade effects.
 * All rendering is pure SVG (SSR-safe, no browser APIs).
 */

import React, { useId } from 'react';
import { cn } from '../../../core';
import { PatternTile, getTileDimensions } from '../../../core';
import type { PatternVariant } from '../../../core';
import { Box } from '../../../core';

export interface GeometricPatternProps {
    /** Which geometric tile design */
    variant?: PatternVariant;
    /** Layout mode */
    mode?: 'background' | 'left' | 'right' | 'dual' | 'around' | 'frame';
    /** Overall opacity (default: 0.06) */
    opacity?: number;
    /** Stroke color passed to PatternTile */
    color?: string;
    /** Tile scale multiplier (default: 1) */
    scale?: number;
    /** Stroke width passed to PatternTile */
    strokeWidth?: number;
    /** Content to wrap (used in frame mode) */
    children?: React.ReactNode;
    className?: string;
}

/* ── Shared pattern SVG definition ────────────────────────────────────── */

function PatternDefs({
    patternId,
    variant,
    size,
    color,
    strokeWidth,
}: {
    patternId: string;
    variant: PatternVariant;
    size: number;
    color: string;
    strokeWidth: number;
}) {
    const dims = getTileDimensions(variant, size);
    return (
        <defs>
            <pattern
                id={patternId}
                x="0"
                y="0"
                width={dims.width}
                height={dims.height}
                patternUnits="userSpaceOnUse"
            >
                <PatternTile
                    variant={variant}
                    size={size}
                    color={color}
                    strokeWidth={strokeWidth}
                />
            </pattern>
        </defs>
    );
}

/* ── Background mode ──────────────────────────────────────────────────── */

function BackgroundMode({
    patternId,
    variant,
    size,
    color,
    strokeWidth,
    opacity,
    className,
}: {
    patternId: string;
    variant: PatternVariant;
    size: number;
    color: string;
    strokeWidth: number;
    opacity: number;
    className?: string;
}) {
    return (
        <svg
            className={cn('absolute inset-0 w-full h-full pointer-events-none', className)}
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <PatternDefs
                patternId={patternId}
                variant={variant}
                size={size}
                color={color}
                strokeWidth={strokeWidth}
            />
            <rect
                width="100%"
                height="100%"
                fill={`url(#${patternId})`}
                opacity={opacity}
            />
        </svg>
    );
}

/* ── Left/Right fade mode ─────────────────────────────────────────────── */

function SideMode({
    patternId,
    variant,
    size,
    color,
    strokeWidth,
    opacity,
    side,
    className,
}: {
    patternId: string;
    variant: PatternVariant;
    size: number;
    color: string;
    strokeWidth: number;
    opacity: number;
    side: 'left' | 'right';
    className?: string;
}) {
    const maskId = `${patternId}-mask`;
    const gradientId = `${patternId}-grad`;

    // Gradient direction: visible side is opaque, opposite fades out
    const x1 = side === 'left' ? '0%' : '100%';
    const x2 = side === 'left' ? '60%' : '40%';

    return (
        <svg
            className={cn('absolute inset-0 w-full h-full pointer-events-none', className)}
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <PatternDefs
                patternId={patternId}
                variant={variant}
                size={size}
                color={color}
                strokeWidth={strokeWidth}
            />
            <defs>
                <linearGradient id={gradientId} x1={x1} y1="0%" x2={x2} y2="0%">
                    <stop offset="0%" stopColor="white" stopOpacity="1" />
                    <stop offset="100%" stopColor="white" stopOpacity="0" />
                </linearGradient>
                <mask id={maskId}>
                    <rect width="100%" height="100%" fill={`url(#${gradientId})`} />
                </mask>
            </defs>
            <rect
                width="100%"
                height="100%"
                fill={`url(#${patternId})`}
                mask={`url(#${maskId})`}
                opacity={opacity}
            />
        </svg>
    );
}

/* ── Dual mode (left + right fades combined) ──────────────────────────── */

function DualMode({
    patternId,
    variant,
    size,
    color,
    strokeWidth,
    opacity,
    className,
}: {
    patternId: string;
    variant: PatternVariant;
    size: number;
    color: string;
    strokeWidth: number;
    opacity: number;
    className?: string;
}) {
    const maskId = `${patternId}-dmask`;
    const gradientId = `${patternId}-dgrad`;

    return (
        <svg
            className={cn('absolute inset-0 w-full h-full pointer-events-none', className)}
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <PatternDefs
                patternId={patternId}
                variant={variant}
                size={size}
                color={color}
                strokeWidth={strokeWidth}
            />
            <defs>
                {/* Gradient: opaque at both edges, transparent in the center */}
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="white" stopOpacity="1" />
                    <stop offset="35%" stopColor="white" stopOpacity="0" />
                    <stop offset="65%" stopColor="white" stopOpacity="0" />
                    <stop offset="100%" stopColor="white" stopOpacity="1" />
                </linearGradient>
                <mask id={maskId}>
                    <rect width="100%" height="100%" fill={`url(#${gradientId})`} />
                </mask>
            </defs>
            <rect
                width="100%"
                height="100%"
                fill={`url(#${patternId})`}
                mask={`url(#${maskId})`}
                opacity={opacity}
            />
        </svg>
    );
}

/* ── Around mode (pattern on all edges, fading to clear center) ────────── */

function AroundMode({
    patternId,
    variant,
    size,
    color,
    strokeWidth,
    opacity,
    className,
}: {
    patternId: string;
    variant: PatternVariant;
    size: number;
    color: string;
    strokeWidth: number;
    opacity: number;
    className?: string;
}) {
    const maskId = `${patternId}-amask`;
    const gradientId = `${patternId}-agrad`;

    return (
        <svg
            className={cn('absolute inset-0 w-full h-full pointer-events-none', className)}
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <PatternDefs
                patternId={patternId}
                variant={variant}
                size={size}
                color={color}
                strokeWidth={strokeWidth}
            />
            <defs>
                {/* Radial gradient: transparent center, opaque edges */}
                <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="white" stopOpacity="0" />
                    <stop offset="55%" stopColor="white" stopOpacity="0" />
                    <stop offset="85%" stopColor="white" stopOpacity="1" />
                    <stop offset="100%" stopColor="white" stopOpacity="1" />
                </radialGradient>
                <mask id={maskId}>
                    <rect width="100%" height="100%" fill={`url(#${gradientId})`} />
                </mask>
            </defs>
            <rect
                width="100%"
                height="100%"
                fill={`url(#${patternId})`}
                mask={`url(#${maskId})`}
                opacity={opacity}
            />
        </svg>
    );
}

/* ── Frame mode ───────────────────────────────────────────────────────── */

function FrameStrip({
    patternId,
    variant,
    size,
    color,
    strokeWidth,
    opacity,
    height,
}: {
    patternId: string;
    variant: PatternVariant;
    size: number;
    color: string;
    strokeWidth: number;
    opacity: number;
    height: number;
}) {
    return (
        <svg
            className="w-full pointer-events-none"
            style={{ height }}
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <PatternDefs
                patternId={patternId}
                variant={variant}
                size={size}
                color={color}
                strokeWidth={strokeWidth}
            />
            <rect
                width="100%"
                height="100%"
                fill={`url(#${patternId})`}
                opacity={opacity}
            />
        </svg>
    );
}

/* ── GeometricPattern ─────────────────────────────────────────────────── */

export const GeometricPattern: React.FC<GeometricPatternProps> = ({
    variant = 'star8',
    mode = 'background',
    opacity = 0.06,
    color = 'var(--color-primary)',
    scale = 1,
    strokeWidth = 0.5,
    children,
    className,
}) => {
    const reactId = useId();
    const patternId = `gp${reactId.replace(/:/g, '')}`;
    const size = 60 * scale;
    const stripHeight = 40 * scale;

    if (mode === 'frame') {
        const topId = `${patternId}-top`;
        const botId = `${patternId}-bot`;
        return (
            <Box className={cn('relative', className)}>
                <FrameStrip
                    patternId={topId}
                    variant={variant}
                    size={size}
                    color={color}
                    strokeWidth={strokeWidth}
                    opacity={opacity}
                    height={stripHeight}
                />
                {children}
                <FrameStrip
                    patternId={botId}
                    variant={variant}
                    size={size}
                    color={color}
                    strokeWidth={strokeWidth}
                    opacity={opacity}
                    height={stripHeight}
                />
            </Box>
        );
    }

    if (mode === 'around') {
        return (
            <AroundMode
                patternId={patternId}
                variant={variant}
                size={size}
                color={color}
                strokeWidth={strokeWidth}
                opacity={opacity}
                className={className}
            />
        );
    }

    if (mode === 'dual') {
        return (
            <DualMode
                patternId={patternId}
                variant={variant}
                size={size}
                color={color}
                strokeWidth={strokeWidth}
                opacity={opacity}
                className={className}
            />
        );
    }

    if (mode === 'left' || mode === 'right') {
        return (
            <SideMode
                patternId={patternId}
                variant={variant}
                size={size}
                color={color}
                strokeWidth={strokeWidth}
                opacity={opacity}
                side={mode}
                className={className}
            />
        );
    }

    // Default: background mode
    return (
        <BackgroundMode
            patternId={patternId}
            variant={variant}
            size={size}
            color={color}
            strokeWidth={strokeWidth}
            opacity={opacity}
            className={className}
        />
    );
};

GeometricPattern.displayName = 'GeometricPattern';
