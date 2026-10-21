'use client';

import React from 'react';
import { AvlState } from '../atoms/AvlState';
import { AvlTransition } from '../atoms/AvlTransition';
import { AvlEvent } from '../atoms/AvlEvent';
import { AvlGuard } from '../atoms/AvlGuard';
import { AvlEffect } from '../atoms/AvlEffect';
import { ringPositions } from '../../../lib/avl-layout';

export interface AvlClosedCircuitState {
  name: string;
}

export interface AvlClosedCircuitTransition {
  from: string;
  to: string;
  event?: string;
  guard?: string;
  effects?: string[];
}

export interface AvlClosedCircuitProps {
  states: AvlClosedCircuitState[];
  transitions: AvlClosedCircuitTransition[];
  className?: string;
  color?: string;
  animated?: boolean;
}

let avlCcId = 0;

export const AvlClosedCircuit: React.FC<AvlClosedCircuitProps> = ({
  states,
  transitions,
  className,
  color = 'var(--color-primary)',
  animated = false,
}) => {
  const ids = React.useMemo(() => {
    avlCcId += 1;
    const base = `avl-cc-${avlCcId}`;
    return { glow: `${base}-glow`, grad: `${base}-grad`, arrow: `${base}-arrow` };
  }, []);

  const cx = 300;
  const cy = 200;
  const r = 120;
  const stateW = 80;
  const stateH = 32;

  const positions = ringPositions(cx, cy, r, states.length);
  const stateIndex = new Map(states.map((s, i) => [s.name, i]));

  return (
    <svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <filter id={ids.glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id={ids.grad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity={0.15} />
          <stop offset="50%" stopColor={color} stopOpacity={0.4} />
          <stop offset="100%" stopColor={color} stopOpacity={0.15} />
        </linearGradient>
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
      </defs>

      {animated && (
        <style>{`
          @keyframes avl-cc-flow { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }
        `}</style>
      )}

      {/* Ambient rings */}
      <circle cx={cx} cy={cy} r={r + 30} fill="none" stroke={color} strokeWidth={0.3} opacity={0.06} />
      <circle cx={cx} cy={cy} r={50} fill="none" stroke={color} strokeWidth={0.5} opacity={0.08} />

      {/* Circuit paths */}
      {transitions.map((tr, i) => {
        const fromIdx = stateIndex.get(tr.from);
        const toIdx = stateIndex.get(tr.to);
        if (fromIdx === undefined || toIdx === undefined) return null;

        const fp = positions[fromIdx];
        const tp = positions[toIdx];

        // Curved arc between positions
        const dx = tp.x - fp.x;
        const dy = tp.y - fp.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / dist;
        const ny = dy / dist;

        const x1 = fp.x + nx * (stateW / 2 + 4);
        const y1 = fp.y + ny * (stateH / 2 + 4);
        const x2 = tp.x - nx * (stateW / 2 + 8);
        const y2 = tp.y - ny * (stateH / 2 + 8);

        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const curvature = dist * 0.25;
        let perpX = -ny;
        let perpY = nx;

        // Ensure curve bows OUTWARD from center
        const testX = mx + perpX * curvature;
        const testY = my + perpY * curvature;
        const distTest = Math.sqrt((testX - cx) ** 2 + (testY - cy) ** 2);
        const distMid = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2);
        if (distTest < distMid) {
          perpX = -perpX;
          perpY = -perpY;
        }

        const cpx = mx + perpX * curvature;
        const cpy = my + perpY * curvature;

        const d = `M${x1},${y1} Q${cpx},${cpy} ${x2},${y2}`;

        return (
          <g key={`cc-tr-${i}`}>
            <path
              d={d}
              fill="none"
              stroke={`url(#${ids.grad})`}
              strokeWidth={1.5}
              strokeDasharray={animated ? '8 6' : undefined}
              markerEnd={`url(#${ids.arrow})`}
              style={animated ? { animation: 'avl-cc-flow 1.5s linear infinite' } : undefined}
            />
            {/* Event */}
            {tr.event && (
              <AvlEvent
                x={cpx}
                y={cpy - 14}
                size={8}
                label={tr.event}
                color={color}
                opacity={0.8}
              />
            )}
            {/* Guard */}
            {tr.guard && (
              <AvlGuard
                x={mx}
                y={my - 8}
                size={10}
                label={tr.guard}
                color={color}
                opacity={0.6}
              />
            )}
            {/* Effects */}
            {tr.effects?.map((eff, j) => (
              <AvlEffect
                key={j}
                x={mx + (j - ((tr.effects?.length ?? 1) - 1) / 2) * 14}
                y={my + 14}
                effectType={eff}
                size={5}
                color={color}
                opacity={0.7}
              />
            ))}
          </g>
        );
      })}

      {/* States */}
      {states.map((state, i) => {
        const pos = positions[i];
        return (
          <AvlState
            key={state.name}
            x={pos.x - stateW / 2}
            y={pos.y - stateH / 2}
            width={stateW}
            height={stateH}
            name={state.name}
            color={color}
          />
        );
      })}

      {/* Center dot */}
      <circle cx={cx} cy={cy} r={3} fill={color} opacity={0.4} />
    </svg>
  );
};

AvlClosedCircuit.displayName = 'AvlClosedCircuit';
