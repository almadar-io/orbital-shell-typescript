'use client';

import React from 'react';
import { AvlOrbital } from '../atoms/AvlOrbital';
import { AvlEntity } from '../atoms/AvlEntity';
import { AvlEffect } from '../atoms/AvlEffect';

export interface AvlEmitListenProps {
  emitter: { name: string; fields?: number };
  listener: { name: string; fields?: number };
  eventName?: string;
  className?: string;
  color?: string;
  animated?: boolean;
}

let avlElId = 0;

export const AvlEmitListen: React.FC<AvlEmitListenProps> = ({
  emitter,
  listener,
  eventName,
  className,
  color = 'var(--color-primary)',
  animated = false,
}) => {
  const ids = React.useMemo(() => {
    avlElId += 1;
    const base = `avl-el-${avlElId}`;
    return { arrow: `${base}-arrow`, grad: `${base}-grad` };
  }, []);

  const leftCx = 180;
  const rightCx = 420;
  const cy = 200;
  const orbR = 80;

  return (
    <svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <marker
          id={ids.arrow}
          markerWidth="8"
          markerHeight="6"
          refX="7"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L8,3 L0,6 Z" fill={color} opacity={0.6} />
        </marker>
        <linearGradient id={ids.grad} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity={0.5} />
          <stop offset="100%" stopColor={color} stopOpacity={0.2} />
        </linearGradient>
      </defs>

      {animated && (
        <style>{`
          @keyframes avl-el-dash { from { stroke-dashoffset: 16; } to { stroke-dashoffset: 0; } }
        `}</style>
      )}

      {/* Emitter orbital */}
      <AvlOrbital cx={leftCx} cy={cy} r={orbR} label={emitter.name} color={color} />
      <AvlEntity x={leftCx} y={cy} r={18} fieldCount={emitter.fields ?? 3} color={color} />

      {/* Listener orbital */}
      <AvlOrbital cx={rightCx} cy={cy} r={orbR} label={listener.name} color={color} />
      <AvlEntity x={rightCx} y={cy} r={18} fieldCount={listener.fields ?? 3} color={color} />

      {/* Dashed emit/listen wire */}
      <path
        d={`M${leftCx + orbR + 4},${cy} L${rightCx - orbR - 8},${cy}`}
        fill="none"
        stroke={`url(#${ids.grad})`}
        strokeWidth={2}
        strokeDasharray="6 4"
        markerEnd={`url(#${ids.arrow})`}
        style={animated ? { animation: 'avl-el-dash 1s linear infinite' } : undefined}
      />

      {/* Event label centered above the wire */}
      {eventName && (
        <text
          x={300}
          y={cy - 22}
          textAnchor="middle"
          fill={color}
          fontSize={11}
          fontFamily="inherit"
          fontWeight="bold"
          opacity={0.8}
        >
          ~{eventName}
        </text>
      )}

      {/* Emit icon centered above the label */}
      <AvlEffect
        x={300}
        y={cy - 46}
        effectType="emit"
        size={7}
        color={color}
        opacity={0.6}
      />

      {/* Tilde markers below the wire */}
      <text
        x={300}
        y={cy + 18}
        textAnchor="middle"
        fill={color}
        fontSize={12}
        fontFamily="inherit"
        opacity={0.3}
        letterSpacing={4}
      >
        ~ ~ ~
      </text>
    </svg>
  );
};

AvlEmitListen.displayName = 'AvlEmitListen';
