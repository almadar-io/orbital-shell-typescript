'use client';

import React from 'react';
import { useTranslate } from '../../../core';
import { CONNECTION_COLORS } from '../../../lib/avl-theme';

export interface AvlSwimLaneProps {
  listenedEvents: string[];
  emittedEvents: string[];
  centerWidth: number;
  height: number;
  color?: string;
  children: React.ReactNode;
}

const GUTTER_WIDTH = 120;
const EVENT_SPACING = 24;
const HEADER_Y = 16;
const EVENT_START_Y = 36;

export const AvlSwimLane: React.FC<AvlSwimLaneProps> = ({
  listenedEvents,
  emittedEvents,
  centerWidth,
  height,
  color = 'var(--color-primary)',
  children,
}) => {
  const { t, locale } = useTranslate();
  const rightX = GUTTER_WIDTH + centerWidth;
  const totalWidth = rightX + GUTTER_WIDTH;
  const emitColor = CONNECTION_COLORS.emitListen.color;

  return (
    <g>
      {/* Left gutter: LISTENS */}
      {listenedEvents.length > 0 && (
        <g>
          <text
            x={8}
            y={HEADER_Y}
            fontSize={10}
            fontWeight={600}
            fill={color}
            opacity={0.4}
            fontFamily="inherit"
          >
            {t('avlSwimLane.listens').toLocaleUpperCase(locale)}
          </text>
          {listenedEvents.map((evt, i) => {
            const ey = EVENT_START_Y + i * EVENT_SPACING;
            return (
              <g key={evt + i}>
                {/* Left-pointing triangle */}
                <polygon
                  points={`${4},${ey} ${12},${ey - 5} ${12},${ey + 5}`}
                  fill={emitColor}
                  opacity={0.6}
                />
                <text
                  x={16}
                  y={ey + 4}
                  fontSize={11}
                  fontWeight={500}
                  fill={color}
                  opacity={0.6}
                  fontFamily="inherit"
                >
                  {evt}
                </text>
                {/* Dotted connector to center lane */}
                <line
                  x1={GUTTER_WIDTH - 4}
                  y1={ey}
                  x2={GUTTER_WIDTH}
                  y2={ey}
                  stroke={emitColor}
                  strokeWidth={1}
                  strokeDasharray="3 2"
                  opacity={0.4}
                />
              </g>
            );
          })}
        </g>
      )}

      {/* Vertical separator: left */}
      <line
        x1={GUTTER_WIDTH}
        y1={0}
        x2={GUTTER_WIDTH}
        y2={height}
        stroke={color}
        strokeWidth={0.5}
        strokeDasharray="4 3"
        opacity={0.12}
      />

      {/* Center lane: state machine content */}
      <g transform={`translate(${GUTTER_WIDTH}, 0)`}>
        {children}
      </g>

      {/* Vertical separator: right */}
      <line
        x1={rightX}
        y1={0}
        x2={rightX}
        y2={height}
        stroke={color}
        strokeWidth={0.5}
        strokeDasharray="4 3"
        opacity={0.12}
      />

      {/* Right gutter: EMITS */}
      {emittedEvents.length > 0 && (
        <g>
          <text
            x={rightX + 8}
            y={HEADER_Y}
            fontSize={10}
            fontWeight={600}
            fill={color}
            opacity={0.4}
            fontFamily="inherit"
          >
            {t('avlSwimLane.emits').toLocaleUpperCase(locale)}
          </text>
          {emittedEvents.map((evt, i) => {
            const ey = EVENT_START_Y + i * EVENT_SPACING;
            return (
              <g key={evt + i}>
                {/* Right-anchored text so the right-pointing triangle stays
                    at the outer edge and long event names grow leftward
                    instead of plowing through the arrow. Mirrors LISTENS. */}
                <text
                  x={totalWidth - 18}
                  y={ey + 4}
                  fontSize={11}
                  fontWeight={500}
                  fill={color}
                  opacity={0.6}
                  fontFamily="inherit"
                  textAnchor="end"
                >
                  {evt}
                </text>
                {/* Right-pointing triangle (outbound emit) */}
                <polygon
                  points={`${totalWidth - 4},${ey} ${totalWidth - 12},${ey - 5} ${totalWidth - 12},${ey + 5}`}
                  fill={emitColor}
                  opacity={0.6}
                />
                {/* Dotted connector from center lane */}
                <line
                  x1={rightX}
                  y1={ey}
                  x2={rightX + 4}
                  y2={ey}
                  stroke={emitColor}
                  strokeWidth={1}
                  strokeDasharray="3 2"
                  opacity={0.4}
                />
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
};

AvlSwimLane.displayName = 'AvlSwimLane';
