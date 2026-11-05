'use client';

/**
 * DetailView — Transition specification card for the detail zoom band (2.5x-5.0x).
 *
 * Renders a spec card with: from/to AvlState nodes, AvlEvent trigger,
 * AvlGuard diamond, numbered AvlEffect icons with binding paths,
 * and AvlFieldType shapes.
 */

import React from 'react';
import { useTranslate } from '../../../core';
import { AvlState } from '../atoms/AvlState';
import { AvlEvent } from '../atoms/AvlEvent';
import { AvlGuard } from '../atoms/AvlGuard';
import { AvlEffect } from '../atoms/AvlEffect';
import { getStateRole } from '../../../lib/avl-theme';
import { type AvlNodeData } from '../../../lib/avl-flow-converter';

export interface DetailViewProps {
  data: AvlNodeData;
}

export const DetailView: React.FC<DetailViewProps> = ({ data }) => {
  const { t } = useTranslate();
  // Show the first transition of the first trait
  const traitName = data.traits[0]?.name;
  const traitData = traitName ? data.traitDetails[traitName] : undefined;

  if (!traitData || traitData.transitions.length === 0) {
    return (
      <div className="rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-card)] p-4 text-center text-[var(--color-muted-foreground)] text-sm">
        {t('detailView.noTransitionData')}
      </div>
    );
  }

  const transition = traitData.transitions[0];
  const fromState = traitData.states.find(s => s.name === transition.from);
  const toState = traitData.states.find(s => s.name === transition.to);

  // Role detection
  const transitionCounts: Record<string, number> = {};
  for (const s of traitData.states) transitionCounts[s.name] = 0;
  for (const t of traitData.transitions) {
    transitionCounts[t.from] = (transitionCounts[t.from] ?? 0) + 1;
    transitionCounts[t.to] = (transitionCounts[t.to] ?? 0) + 1;
  }
  const maxTC = Math.max(...Object.values(transitionCounts), 0);

  const fromRole = getStateRole(fromState?.isInitial ?? undefined, fromState?.isTerminal ?? undefined, transitionCounts[transition.from] ?? 0, maxTC);
  const toRole = getStateRole(toState?.isInitial ?? undefined, toState?.isTerminal ?? undefined, transitionCounts[transition.to] ?? 0, maxTC);

  const hasGuard = transition.guard != null;

  return (
    <div className="rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden" style={{ minWidth: 380, maxWidth: 500 }}>
      {/* Header: from state → to state */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-background)]">
        <div className="flex items-center gap-3">
          <svg width={90} height={32} viewBox="0 0 90 32">
            <AvlState x={0} y={0} width={80} height={28} name={transition.from} role={fromRole} isInitial={fromState?.isInitial ?? undefined} isTerminal={fromState?.isTerminal ?? undefined} />
          </svg>
          <svg width={24} height={16} viewBox="0 0 24 16">
            <line x1={0} y1={8} x2={18} y2={8} stroke="var(--color-muted-foreground)" strokeWidth={2} />
            <polygon points="18,4 24,8 18,12" fill="var(--color-muted-foreground)" />
          </svg>
          <svg width={90} height={32} viewBox="0 0 90 32">
            <AvlState x={0} y={0} width={80} height={28} name={transition.to} role={toRole} isInitial={toState?.isInitial ?? undefined} isTerminal={toState?.isTerminal ?? undefined} />
          </svg>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* TRIGGER */}
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)] mb-1">{t('avl.trigger')}</div>
          <div className="flex items-center gap-1.5">
            <svg width={16} height={16} viewBox="0 0 16 16">
              <AvlEvent x={8} y={8} size={7} />
            </svg>
            <span className="text-sm font-semibold text-[var(--color-foreground)]">{transition.event}</span>
          </div>
        </div>

        {/* GUARD */}
        {hasGuard && (
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)] mb-1">{t('avl.guard')}</div>
            <div className="flex items-center gap-1.5">
              <svg width={14} height={14} viewBox="0 0 14 14">
                <AvlGuard x={7} y={7} size={6} />
              </svg>
              <span className="text-xs font-mono text-[var(--color-muted-foreground)] opacity-60">
                {typeof transition.guard === 'string' ? transition.guard : JSON.stringify(transition.guard)}
              </span>
            </div>
          </div>
        )}

        {/* EFFECTS */}
        {transition.effects.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)] mb-1">{t('avl.effects')}</div>
            <div className="space-y-1.5">
              {transition.effects.map((effect, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-xs text-[var(--color-muted-foreground)] w-3 text-right mt-0.5">{i + 1}.</span>
                  <svg width={18} height={18} viewBox="0 0 20 20">
                    <AvlEffect x={10} y={10} effectType={effect.type} size={8} showBackground />
                  </svg>
                  <span className="text-xs text-[var(--color-foreground)]">{effect.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

DetailView.displayName = 'DetailView';
