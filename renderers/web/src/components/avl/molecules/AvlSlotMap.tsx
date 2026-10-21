'use client';

import React from 'react';
import { useTranslate } from '../../../core';

export interface AvlSlotMapSlot {
  name: string;
  /** Manual position overrides. Omit for auto-layout. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface AvlSlotMapProps {
  slots: AvlSlotMapSlot[];
  pageWidth?: number;
  pageHeight?: number;
  className?: string;
  color?: string;
  animated?: boolean;
}

/** Known slot positions within a standard page layout (360x256 content area). */
const SLOT_PRESETS: Record<string, { x: number; y: number; width: number; height: number }> = {
  header:  { x: 10, y: 5,   width: 340, height: 35 },
  main:    { x: 120, y: 50,  width: 230, height: 195 },
  sidebar: { x: 10, y: 50,  width: 100, height: 195 },
  modal:   { x: 80, y: 60,  width: 200, height: 140 },
  drawer:  { x: 220, y: 50, width: 130, height: 195 },
  toast:   { x: 220, y: 210, width: 130, height: 35 },
  footer:  { x: 10, y: 220, width: 340, height: 30 },
  center:  { x: 60, y: 50,  width: 240, height: 195 },
  'hud-top':    { x: 10, y: 5,   width: 340, height: 30 },
  'hud-bottom': { x: 10, y: 220, width: 340, height: 30 },
};

function resolveSlot(slot: AvlSlotMapSlot, fallbackIdx: number): Required<AvlSlotMapSlot> {
  // If all coordinates provided, use them directly
  if (slot.x !== undefined && slot.y !== undefined && slot.width !== undefined && slot.height !== undefined) {
    return slot as Required<AvlSlotMapSlot>;
  }
  // Look up preset by name
  const preset = SLOT_PRESETS[slot.name];
  if (preset) {
    return {
      name: slot.name,
      x: slot.x ?? preset.x,
      y: slot.y ?? preset.y,
      width: slot.width ?? preset.width,
      height: slot.height ?? preset.height,
    };
  }
  // Unknown slot: place in a grid in the remaining space
  const col = fallbackIdx % 2;
  const row = Math.floor(fallbackIdx / 2);
  return {
    name: slot.name,
    x: 10 + col * 175,
    y: 50 + row * 100,
    width: 165,
    height: 90,
  };
}

export const AvlSlotMap: React.FC<AvlSlotMapProps> = ({
  slots,
  pageWidth = 360,
  pageHeight = 280,
  className,
  color = 'var(--color-primary)',
  animated = false,
}) => {
  const { t } = useTranslate();
  // Center the page frame in the viewBox
  const ox = (600 - pageWidth) / 2;
  const oy = (400 - pageHeight) / 2;

  let unknownIdx = 0;
  const resolvedSlots = slots.map((slot) => {
    const isUnknown = !SLOT_PRESETS[slot.name] && (slot.x === undefined || slot.y === undefined);
    const resolved = resolveSlot(slot, isUnknown ? unknownIdx : 0);
    if (isUnknown) unknownIdx++;
    return resolved;
  });

  return (
    <svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" className={className}>
      {animated && (
        <style>{`
          @keyframes avl-slot-pulse { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.25; } }
        `}</style>
      )}

      {/* Page frame */}
      <rect
        x={ox}
        y={oy}
        width={pageWidth}
        height={pageHeight}
        rx={4}
        ry={4}
        fill="none"
        stroke={color}
        strokeWidth={2}
      />

      {/* Title bar */}
      <rect
        x={ox}
        y={oy}
        width={pageWidth}
        height={24}
        rx={4}
        ry={4}
        fill={color}
        opacity={0.1}
      />
      <text
        x={ox + pageWidth / 2}
        y={oy + 16}
        textAnchor="middle"
        fill={color}
        fontSize={10}
        fontFamily="inherit"
        fontWeight="bold"
      >
        {t('avl.pageLayout')}
      </text>

      {/* Named slot regions - content slots first, then overlays on top */}
      {resolvedSlots.map((slot) => {
        const isOverlay = ['modal', 'drawer', 'toast'].includes(slot.name);
        return (
        <g key={slot.name}>
          {/* Drop shadow for overlays */}
          {isOverlay && (
            <rect
              x={ox + slot.x + 3}
              y={oy + 24 + slot.y + 3}
              width={slot.width}
              height={slot.height}
              rx={3}
              ry={3}
              fill="var(--color-foreground)"
              opacity={0.06}
            />
          )}
          <rect
            x={ox + slot.x}
            y={oy + 24 + slot.y}
            width={slot.width}
            height={slot.height}
            rx={3}
            ry={3}
            fill={isOverlay ? 'var(--color-surface)' : color}
            opacity={isOverlay ? 0.9 : 0.08}
            stroke={color}
            strokeWidth={isOverlay ? 1.5 : 1}
            strokeDasharray={isOverlay ? '6 3' : '4 2'}
            style={animated ? { animation: 'avl-slot-pulse 2s ease-in-out infinite' } : undefined}
          />
          <text
            x={ox + slot.x + slot.width / 2}
            y={oy + 24 + slot.y + slot.height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill={color}
            fontSize={9}
            fontFamily="inherit"
            opacity={0.6}
          >
            {slot.name}{isOverlay ? ` ${t('avl.overlaySuffix')}` : ''}
          </text>
        </g>
        );
      })}
    </svg>
  );
};

AvlSlotMap.displayName = 'AvlSlotMap';
