'use client';

/**
 * AvlTransitionScene V2 - Zoom Level 4
 *
 * Card layout replacing vertical waterfall.
 * Reads like a spec card: from → to, trigger, guard, effects.
 */

import React from 'react';
import { useTranslate } from '../../../core';
import { AvlEffect } from '../atoms/AvlEffect';
import type { TransitionLevelData, ExprTreeNode } from '../../../lib/avl-schema-parser';
import { getStateRole, STATE_COLORS } from '../../../lib/avl-theme';

export interface AvlTransitionSceneProps {
  data: TransitionLevelData;
  color?: string;
}

const CX = 300;
const CARD_W = 440;
const CARD_X = CX - CARD_W / 2;
const SECTION_LEFT = CARD_X + 16;
const CONTENT_LEFT = CARD_X + 24;

function flattenEffect(node: ExprTreeNode): { type: string; args: string[] } {
  const args: string[] = [];
  for (const child of node.children ?? []) {
    args.push(child.label);
  }
  return { type: node.label, args };
}

function mapEffectType(label: string): string {
  const valid: string[] = [
    'render-ui', 'set', 'persist', 'fetch', 'emit', 'navigate',
    'call-service', 'spawn', 'despawn', 'do', 'if', 'log',
  ];
  return valid.includes(label) ? (label) : 'log';
}

export const AvlTransitionScene: React.FC<AvlTransitionSceneProps> = ({
  data,
  color = 'var(--color-primary)',
}) => {
  const { t, locale } = useTranslate();
  const fromRole = getStateRole();
  const toRole = getStateRole();
  const fromColors = STATE_COLORS[fromRole];
  const toColors = STATE_COLORS[toRole];

  const hasGuard = !!data.guard;
  const hasEffects = data.effects.length > 0;
  const hasSlots = data.slotTargets.length > 0;

  const effects = data.effects.map(flattenEffect);

  // Dynamic card height
  const headerH = 52;
  const sectionGap = 8;
  const triggerH = 34;
  const guardH = hasGuard ? 30 + sectionGap : 0;
  const effectRowH = 28;
  const effectsH = hasEffects ? 24 + effects.length * effectRowH + sectionGap : 0;
  const slotsH = hasSlots ? 24 + data.slotTargets.length * 22 + sectionGap : 0;
  const cardH = headerH + triggerH + guardH + effectsH + slotsH + 16;

  const cardY = Math.max(20, (400 - cardH) / 2);

  return (
    <g>
      {/* Card outer */}
      <rect
        x={CARD_X}
        y={cardY}
        width={CARD_W}
        height={cardH}
        rx={12}
        fill="var(--color-surface, white)"
        fillOpacity={0.97}
        stroke={color}
        strokeWidth={0.8}
        strokeOpacity={0.2}
      />

      {/* ── Header: From → To ── */}
      <rect
        x={CARD_X}
        y={cardY}
        width={CARD_W}
        height={headerH}
        rx={12}
        fill={color}
        fillOpacity={0.03}
      />
      {/* Clip bottom corners of header */}
      <rect
        x={CARD_X}
        y={cardY + headerH - 12}
        width={CARD_W}
        height={12}
        fill={color}
        fillOpacity={0.03}
      />

      {/* From state pill */}
      <rect
        x={CARD_X + 20}
        y={cardY + 12}
        width={140}
        height={30}
        rx={15}
        fill={fromColors.fill}
        stroke={fromColors.border}
        strokeWidth={1.5}
      />
      <text
        x={CARD_X + 90}
        y={cardY + 31}
        textAnchor="middle"
        fill={fromColors.border}
        fontSize={14}
        fontWeight={600}
        fontFamily="inherit"
      >
        {data.from}
      </text>

      {/* Arrow */}
      <text
        x={CX}
        y={cardY + 32}
        textAnchor="middle"
        fill={color}
        fontSize={16}
        opacity={0.4}
        fontFamily="inherit"
      >
        →
      </text>

      {/* To state pill */}
      <rect
        x={CARD_X + CARD_W - 160}
        y={cardY + 12}
        width={140}
        height={30}
        rx={15}
        fill={toColors.fill}
        stroke={toColors.border}
        strokeWidth={1.5}
      />
      <text
        x={CARD_X + CARD_W - 90}
        y={cardY + 31}
        textAnchor="middle"
        fill={toColors.border}
        fontSize={14}
        fontWeight={600}
        fontFamily="inherit"
      >
        {data.to}
      </text>

      {/* Divider */}
      <line
        x1={CARD_X + 12}
        y1={cardY + headerH}
        x2={CARD_X + CARD_W - 12}
        y2={cardY + headerH}
        stroke={color}
        strokeWidth={0.5}
        opacity={0.1}
      />

      {/* ── TRIGGER section ── */}
      {(() => {
        const secY = cardY + headerH + sectionGap;
        return (
          <g>
            <text x={SECTION_LEFT} y={secY + 12} fill={color} fontSize={10} fontWeight={600} opacity={0.4} fontFamily="inherit">
              {t('avl.trigger').toLocaleUpperCase(locale)}
            </text>
            <text x={CONTENT_LEFT + 14} y={secY + 28} fill={color} fontSize={14} fontWeight={600} fontFamily="inherit">
              {data.event}
            </text>
            <text x={CONTENT_LEFT + 4} y={secY + 28} fill={color} fontSize={10} opacity={0.5}>⚡</text>
          </g>
        );
      })()}

      {/* ── GUARD section ── */}
      {hasGuard && data.guard && (() => {
        const secY = cardY + headerH + sectionGap + triggerH;
        return (
          <g>
            <text x={SECTION_LEFT} y={secY + 12} fill={color} fontSize={10} fontWeight={600} opacity={0.4} fontFamily="inherit">
              {t('avl.guard').toLocaleUpperCase(locale)}
            </text>
            <polygon
              points={`${CONTENT_LEFT + 6},${secY + 22} ${CONTENT_LEFT + 2},${secY + 26} ${CONTENT_LEFT + 6},${secY + 30} ${CONTENT_LEFT + 10},${secY + 26}`}
              fill="none"
              stroke={color}
              strokeWidth={1}
              opacity={0.5}
            />
            <text x={CONTENT_LEFT + 18} y={secY + 29} fill={color} fontSize={12} fontWeight={400} opacity={0.6} fontFamily="inherit">
              {data.guard.label}
            </text>
          </g>
        );
      })()}

      {/* ── EFFECTS section ── */}
      {hasEffects && (() => {
        const secY = cardY + headerH + sectionGap + triggerH + guardH;
        return (
          <g>
            <text x={SECTION_LEFT} y={secY + 12} fill={color} fontSize={10} fontWeight={600} opacity={0.4} fontFamily="inherit">
              {t('avl.effects').toLocaleUpperCase(locale)}
            </text>
            {effects.map((eff, i) => {
              const rowY = secY + 22 + i * effectRowH;
              const effectType = mapEffectType(eff.type);
              // args may be strings, numbers, or full render-ui pattern objects.
              // Array.join coerces each via String() — which on an object returns
              // '[object Object]'. JSON-stringify non-strings so the actual
              // SExpr / pattern shape is readable.
              const argsText = eff.args.length > 0
                ? eff.args
                    .map((a) => typeof a === 'string' ? a : JSON.stringify(a))
                    .join(' · ')
                : '';
              return (
                <g key={`eff-${i}`}>
                  <AvlEffect
                    x={CONTENT_LEFT + 10}
                    y={rowY + 6}
                    effectType={effectType}
                    size={10}
                    showBackground
                  />
                  <text x={CONTENT_LEFT + 28} y={rowY + 10} fill={color} fontSize={12} fontWeight={500} opacity={0.8} fontFamily="inherit">
                    {eff.type}
                  </text>
                  {argsText && (
                    <text x={CONTENT_LEFT + 28 + eff.type.length * 7 + 8} y={rowY + 10} fill={color} fontSize={10} fontWeight={400} opacity={0.5} fontFamily="monospace">
                      {argsText}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })()}

      {/* ── SLOTS section ── */}
      {hasSlots && (() => {
        const secY = cardY + headerH + sectionGap + triggerH + guardH + effectsH;
        return (
          <g>
            <text x={SECTION_LEFT} y={secY + 12} fill={color} fontSize={10} fontWeight={600} opacity={0.4} fontFamily="inherit">
              {t('avlTransitionScene.slots').toLocaleUpperCase(locale)}
            </text>
            {data.slotTargets.map((slot, i) => {
              const rowY = secY + 22 + i * 22;
              return (
                <g key={`slot-${i}`}>
                  <rect x={CONTENT_LEFT} y={rowY - 4} width={CARD_W - 56} height={18} rx={4} fill={color} fillOpacity={0.04} />
                  <text x={CONTENT_LEFT + 8} y={rowY + 8} fill={color} fontSize={11} fontFamily="inherit">
                    {slot.name}: {slot.pattern}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })()}
    </g>
  );
};

AvlTransitionScene.displayName = 'AvlTransitionScene';
