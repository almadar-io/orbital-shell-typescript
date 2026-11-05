'use client';

/**
 * StateMachineView — the AVL state machine with loading / error / empty states.
 */

import React from 'react';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { LoadingState } from '../molecules/LoadingState';
import { ErrorState } from '../molecules/ErrorState';
import { AvlStateMachine, type AvlStateMachineProps } from '../../avl/molecules/AvlStateMachine';
import type { EventEmit, MountedOrbital, TraitDescription } from '@almadar/core';
import { AvlOrbitalMachine } from '../../avl/molecules/AvlOrbitalMachine';
import { traitLevelFromDescription, type TraitLevelData } from '../../../lib/avl-schema-parser';
import { useTranslate } from '../../../core';
import type { UiError } from '../../../core';

export interface StateMachineViewProps extends Omit<AvlStateMachineProps, 'trait'> {
  /** The trait to draw (see `parseTraitLevel` / `traitLevelFromTrait`). */
  trait?: TraitLevelData;
  /** A described trait (`behavior/describe`), drawn from its machine when no `trait` is given. */
  description?: TraitDescription | null;
  /** A whole mounted orbital (`program/self { mounted: true }`): every trait drawn as nested boxes on one canvas, instead of a single trait.
   * @example {"page":"/orders","traits":[{"trait":"OrderPage","orbital":"Orders","parent":null,"depth":0,"embeddedIn":[],"renders":true,"stepsIn":"browser","linkedEntity":"Order","states":[{"name":"browsing","isInitial":true,"isTerminal":false},{"name":"editing","isInitial":false,"isTerminal":false}],"transitions":[{"index":0,"from":["browsing"],"to":"editing","event":"EDIT","guarded":false,"emits":[]},{"index":1,"from":["editing"],"to":"browsing","event":"CANCEL","guarded":false,"emits":[]}],"emits":[],"listens":[],"instances":[]}]}
   */
  orbital?: MountedOrbital | null;
  /** Current state per trait in orbital mode; a trait without an entry shows the states of its running instances. @default []
   * @example [{"trait":"OrderPage","state":"browsing"}]
   */
  activeStates?: { trait: string; state: string }[];
  /** The last fired transition in orbital mode: its trait and the transition `index`. @default null
   * @example {"trait":"OrderPage","index":0}
   */
  firedTransition?: { trait: string; index: number } | null;
  /** Orbital mode: boxes at a trait depth below this draw their own machine (when they have more than one state). @default 2 */
  expandDepth?: number;
  /** Orbital mode: the trait whose box is marked as chosen. @default "" */
  selectedTrait?: string;
  /** Orbital mode: emitted with the trait's name when a box is chosen. */
  selectEvent?: EventEmit<{ trait: string }>;
  /** Orbital mode: the canvas scrolls inside this height. @default "calc(100vh - 9rem)" */
  maxHeight?: string;
  /** Loading state indicator */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
}

export const StateMachineView: React.FC<StateMachineViewProps> = ({ trait, description, orbital = null, activeStates, firedTransition, expandDepth, selectedTrait, selectEvent, maxHeight, isLoading = false, error = null, className, ...rest }) => {
  const { t } = useTranslate();
  const drawn = trait ?? (description ? traitLevelFromDescription(description) : null);

  if (isLoading) return <LoadingState message={t('stateMachine.loading')} />;
  if (error) return <ErrorState message={error instanceof Error ? error.message : String(error)} />;
  if (orbital !== null && orbital.traits.length > 0) {
    return <AvlOrbitalMachine orbital={orbital} activeStates={activeStates} firedTransition={firedTransition} expandDepth={expandDepth} selectedTrait={selectedTrait} selectEvent={selectEvent} maxHeight={maxHeight} direction={rest.direction} className={className} />;
  }
  if (!drawn) {
    return (
      <Box data-testid="state-machine-view-empty" padding="lg" className="text-center">
        <Typography variant="body" color="muted">{t('stateMachine.noStateMachine')}</Typography>
      </Box>
    );
  }
  return <AvlStateMachine trait={drawn} className={className} {...rest} />;
};

// Compat aliases
export { StateMachineView as DomStateMachineVisualizer };
export { StateMachineView as OrbitalStateMachineView };

StateMachineView.displayName = 'StateMachineView';
