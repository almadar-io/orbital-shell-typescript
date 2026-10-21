'use client';

/**
 * AvlClickTarget
 *
 * Transparent SVG rect overlay that makes AVL atoms clickable.
 * AVL atoms render <g> elements which don't natively support
 * bounding-box click events. This wrapper adds an invisible
 * rect with pointer events and optional hover glow.
 *
 * @packageDocumentation
 */

import React, { useState, useCallback } from 'react';

export interface AvlClickTargetProps {
  /** Bounding box position */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Click handler */
  onClick: () => void;
  /** Hover callback */
  onHover?: (hovering: boolean) => void;
  /** Cursor style (default: pointer) */
  cursor?: string;
  /** Glow color on hover */
  glowColor?: string;
  /** Accessible label */
  label?: string;
  /** Children (the AVL atoms to render on top) */
  children: React.ReactNode;
}

export const AvlClickTarget: React.FC<AvlClickTargetProps> = ({
  x,
  y,
  width,
  height,
  onClick,
  onHover,
  cursor = 'pointer',
  glowColor = 'var(--color-primary)',
  label,
  children,
}) => {
  const [hovering, setHovering] = useState(false);

  const handleMouseEnter = useCallback(() => {
    setHovering(true);
    onHover?.(true);
  }, [onHover]);

  const handleMouseLeave = useCallback(() => {
    setHovering(false);
    onHover?.(false);
  }, [onHover]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  }, [onClick]);

  return (
    <g>
      {/* Hover glow effect */}
      {hovering && (
        <rect
          x={x - 4}
          y={y - 4}
          width={width + 8}
          height={height + 8}
          rx={8}
          fill={glowColor}
          opacity={0.08}
        />
      )}

      {/* The actual AVL atoms */}
      {children}

      {/* Invisible click target on top */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="transparent"
        style={{ cursor }}
        pointerEvents="all"
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label={label}
      />
    </g>
  );
};

AvlClickTarget.displayName = 'AvlClickTarget';
