import type { A11yProps } from '@almadar/core';
import patternTileGeometry from '@almadar/core/patterns/pattern-tile-geometry.json';
import { domPassthrough } from '../lib/domPassthrough';
import React from 'react';

export type PatternVariant =
    | 'star8' | 'star6' | 'khatam' | 'star10' | 'star12'
    | 'rosette-double' | 'rosette-filled'
    | 'seigaiha' | 'greek-key' | 'celtic-knot' | 'kolam'
    | 'arch' | 'arabesque-vine' | 'arabesque-net';

export interface PatternTileProps extends A11yProps {
    variant?: PatternVariant;
    size?: number;
    color?: string;
    strokeWidth?: number;
    className?: string;
}

export const PatternTile: React.FC<PatternTileProps> = ({
    variant = 'star8',
    size = 60,
    color = 'var(--color-primary)',
    strokeWidth = 0.5,
    className,
    ...rest
}) => {
    const tile = patternTileGeometry.variants[variant];
    const scale = size / patternTileGeometry.unit;
    const unitStrokeWidth = scale === 0 ? strokeWidth : strokeWidth / scale;
    return (
        <g className={className} {...domPassthrough(rest)}>
            <g transform={`scale(${scale})`} fill="none" stroke={color} strokeWidth={unitStrokeWidth}>
                {tile.elements.map((element, index) => {
                    const opacity = 'opacity' in element ? element.opacity : undefined;
                    if ('d' in element) {
                        return <path key={index} d={element.d} opacity={opacity} />;
                    }
                    return (
                        <circle
                            key={index}
                            cx={element.cx}
                            cy={element.cy}
                            r={element.r}
                            fill={'filled' in element && element.filled ? color : 'none'}
                            opacity={opacity}
                        />
                    );
                })}
            </g>
        </g>
    );
};

PatternTile.displayName = 'PatternTile';

export function getTileDimensions(variant: PatternVariant, size: number): { width: number; height: number } {
    const tile = patternTileGeometry.variants[variant];
    return { width: size, height: size * tile.height / patternTileGeometry.unit };
}
