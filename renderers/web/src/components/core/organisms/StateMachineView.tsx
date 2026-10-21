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
import type { TraitDescription } from '@almadar/core';
import { traitLevelFromDescription, type TraitLevelData } from '../../../lib/avl-schema-parser';
import { useTranslate } from '../../../core';
import type { UiError } from '../../../core';

export interface StateMachineViewProps extends Omit<AvlStateMachineProps, 'trait'> {
  /** The trait to draw (see `parseTraitLevel` / `traitLevelFromTrait`). */
  trait?: TraitLevelData;
  /** A described trait (`behavior/describe`), drawn from its machine when no `trait` is given. */
  description?: TraitDescription | null;
  /** Loading state indicator */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
}

export const StateMachineView: React.FC<StateMachineViewProps> = ({ trait, description, isLoading = false, error = null, className, ...rest }) => {
  const { t } = useTranslate();
  const drawn = trait ?? (description ? traitLevelFromDescription(description) : null);

  if (isLoading) return <LoadingState message={t('stateMachine.loading')} />;
  if (error) return <ErrorState message={error instanceof Error ? error.message : String(error)} />;
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
