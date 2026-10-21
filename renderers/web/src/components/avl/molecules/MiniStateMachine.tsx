'use client';

/**
 * MiniStateMachine — Inline simplified state machine for the ModuleCard.
 *
 * Renders a compact left-to-right flow of AvlState nodes connected
 * by AvlTransition arrows, with AvlEffect icons below.
 * No ELK layout needed — uses simple horizontal positioning.
 */

import React from 'react';
import { AvlState } from '../atoms/AvlState';
import { AvlEffect } from '../atoms/AvlEffect';
import type { TraitLevelData } from '../../../lib/avl-schema-parser';
import { getStateRole } from '../../../lib/avl-theme';
import type { AvlAnnotations, AvlNote } from '../../../lib/avl-annotations';
import { Box } from '../../../core';
import { AvlExplain } from './AvlExplain';
import { useEffectLines } from './AvlEffectChip';
import { useTranslate } from '../../../core';
import { cn } from '../../../core';

export interface MiniStateMachineProps {
  data: TraitLevelData;
  /** Author notes, shown in a popover on hover of a state or an effect. */
  annotations?: AvlAnnotations;
  className?: string;
}

interface HitBox { left: number; top: number; width: number; height: number }

const hitStyle = (b: HitBox): React.CSSProperties => ({ position: 'absolute', left: b.left, top: b.top, width: b.width, height: b.height });

const HIT_CLASS = 'rounded-full cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const EffectHit: React.FC<{ effectType: string; box: HitBox; note?: AvlNote }> = ({ effectType, box, note }) => {
  const lines = useEffectLines(effectType);
  return (
    <AvlExplain lines={lines} note={note}>
      <Box as="span" role="img" tabIndex={0} aria-label={effectType} className={HIT_CLASS} style={hitStyle(box)} />
    </AvlExplain>
  );
};

const NODE_W = 24;
const NODE_H = 16;
const GAP = 8;
const ARROW_W = 16;
/** AvlState draws its initial marker at cx -16, r 6 and a terminal border 4px out. */
const INITIAL_MARGIN = 24;
const TERMINAL_OUTSET = 4;
/** AvlEffect is centered on (x, y); its background circle has radius 1.2 × size. */
const EFFECT_SIZE = 5;
const EFFECT_R = EFFECT_SIZE * 1.2;
const EFFECT_GAP = 4;
const ROW_GAP = 6;
const EDGE = 2;

export const MiniStateMachine: React.FC<MiniStateMachineProps> = ({ data, annotations, className }) => {
  const { t } = useTranslate();
  const states = data.states;
  if (states.length === 0) return null;

  // Compute transition counts for role detection
  const transitionCounts: Record<string, number> = {};
  for (const s of states) transitionCounts[s.name] = 0;
  for (const t of data.transitions) {
    transitionCounts[t.from] = (transitionCounts[t.from] ?? 0) + 1;
    transitionCounts[t.to] = (transitionCounts[t.to] ?? 0) + 1;
  }
  const maxTC = Math.max(...Object.values(transitionCounts), 0);

  // Collect unique effect types
  const effectTypes = new Set<string>();
  for (const t of data.transitions) {
    for (const e of t.effects) effectTypes.add(e.type);
  }
  const effectList = Array.from(effectTypes).slice(0, 6);

  const stateStep = NODE_W + GAP + ARROW_W + GAP;
  const rowTop = TERMINAL_OUTSET + EDGE;
  const statesRight = INITIAL_MARGIN + (states.length - 1) * stateStep + NODE_W + TERMINAL_OUTSET;
  const effectTop = rowTop + NODE_H + TERMINAL_OUTSET + ROW_GAP;
  const effectCy = effectTop + EFFECT_R;
  const effectStep = EFFECT_R * 2 + EFFECT_GAP;
  const effectsRight = EDGE + effectList.length * effectStep - EFFECT_GAP;
  const svgW = Math.max(statesRight, effectsRight) + EDGE;
  const svgH = (effectList.length > 0 ? effectTop + EFFECT_R * 2 : rowTop + NODE_H + TERMINAL_OUTSET) + EDGE;

  return (
    <Box className={cn('relative inline-block', className)} style={{ width: svgW, height: svgH }}>
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} aria-hidden="true">
      {states.map((s, i) => {
        const x = INITIAL_MARGIN + i * stateStep;
        const tc = transitionCounts[s.name] ?? 0;
        const role = getStateRole(s.isInitial ?? undefined, s.isTerminal ?? undefined, tc, maxTC);

        return (
          <React.Fragment key={s.name}>
            <AvlState
              x={x}
              y={rowTop}
              width={NODE_W}
              height={NODE_H}
              name=""
              role={role}
              isInitial={s.isInitial ?? undefined}
              isTerminal={s.isTerminal ?? undefined}
            />
            {/* Arrow to next state */}
            {i < states.length - 1 && (
              <g>
                <line
                  x1={x + NODE_W + GAP}
                  y1={rowTop + NODE_H / 2}
                  x2={x + NODE_W + GAP + ARROW_W - 3}
                  y2={rowTop + NODE_H / 2}
                  stroke="var(--color-muted-foreground)"
                  strokeWidth={1}
                  opacity={0.4}
                />
                <polygon
                  points={`${x + NODE_W + GAP + ARROW_W - 3},${rowTop + NODE_H / 2 - 2.5} ${x + NODE_W + GAP + ARROW_W},${rowTop + NODE_H / 2} ${x + NODE_W + GAP + ARROW_W - 3},${rowTop + NODE_H / 2 + 2.5}`}
                  fill="var(--color-muted-foreground)"
                  opacity={0.4}
                />
              </g>
            )}
          </React.Fragment>
        );
      })}

      {/* Effect icons below */}
      {effectList.length > 0 && (
        <g>
          {effectList.map((et, i) => (
            <g key={et} data-testid="mini-sm-effect">
              <AvlEffect
                x={EDGE + EFFECT_R + i * effectStep}
                y={effectCy}
                effectType={et}
                size={EFFECT_SIZE}
                showBackground
              />
            </g>
          ))}
        </g>
      )}
    </svg>
      {states.map((s, i) => {
        const marks = [...(s.isInitial ? [t('avl.stateInitial')] : []), ...(s.isTerminal ? [t('avl.stateTerminal')] : [])];
        return (
          <AvlExplain key={`hit-${s.name}`} lines={marks.length > 0 ? [s.name, marks.join(' · ')] : [s.name]} note={annotations?.states?.[s.name]}>
            <Box as="span" role="img" tabIndex={0} aria-label={s.name} className={HIT_CLASS}
              style={hitStyle({ left: INITIAL_MARGIN + i * stateStep, top: rowTop, width: NODE_W, height: NODE_H })} />
          </AvlExplain>
        );
      })}
      {effectList.map((et, i) => (
        <EffectHit key={`hit-${et}`} effectType={et} note={annotations?.effects?.[et]}
          box={{ left: EDGE + i * effectStep, top: effectTop, width: EFFECT_R * 2, height: EFFECT_R * 2 }} />
      ))}
    </Box>
  );
};

MiniStateMachine.displayName = 'MiniStateMachine';
