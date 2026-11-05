'use client';

/**
 * AvlTransitionExplainer — the render-ui face of {@link AvlTransitionDetail}:
 * one transition explained (from, event, to, the guard that must hold, each
 * effect in order) with optional author notes. Playing a transition is a host
 * capability and stays on AvlTransitionDetail.
 */

import React from 'react';
import type { A11yProps, SExpr } from '@almadar/core';
import { Box } from '../../../core';
import { domPassthrough } from '../../../core';
import { AvlTransitionDetail } from './AvlTransitionDetail';
import type { SerializedEffect, TraitTransitionInfo } from '../../../lib/avl-schema-parser';
import type { AvlAnnotations } from '../../../lib/avl-annotations';

/** A transition as `.lolo` data hands it over: `guard` is omitted when there is none. */
export interface ExplainedTransition {
  from: string;
  to: string;
  event: string;
  guard?: SExpr;
  effects: SerializedEffect[];
  index: number;
}

/**
 * One transition explained step by step: from-state, event and to-state, the
 * guard that must hold, and each effect it runs in order.
 *
 * @capabilities transition explainer, event guard effects walkthrough, what happens when an event fires
 */
export interface AvlTransitionExplainerProps extends A11yProps {
  /** Orbital the transition belongs to. */
  orbitalName: string;
  /** Trait the transition belongs to. */
  traitName: string;
  /** The transition to explain.
   * @example {"from":"pending","to":"paid","event":"PAY","effects":[{"type":"set","args":[]},{"type":"persist","args":[]}],"index":0}
   */
  transition: ExplainedTransition;
  /** Author explanations shown in a popover on hover: the event's note and per-effect-type notes.
   * @example {"transitions":{"PAY":{"title":"Paying","body":"The customer pays the order total."}},"effects":{"persist":{"body":"Saves the order."}}}
   */
  annotations?: AvlAnnotations;
  className?: string;
}

export const AvlTransitionExplainer: React.FC<AvlTransitionExplainerProps> = ({ orbitalName, traitName, transition, annotations, className, ...rest }) => {
  const detail: TraitTransitionInfo = { ...transition, guard: transition.guard ?? null };
  return (
    <Box {...domPassthrough(rest)} className={className}>
      <AvlTransitionDetail orbital={orbitalName} trait={traitName} transition={detail} annotations={annotations} />
    </Box>
  );
};

AvlTransitionExplainer.displayName = 'AvlTransitionExplainer';
