'use client';

/**
 * JazariStateMachine — Al-Jazari themed state machine diagram: the AVL state
 * machine drawn with gear-shaped states, from an orbital schema or one trait.
 */

import React, { useMemo } from 'react';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { LoadingState } from './LoadingState';
import { ErrorState } from './ErrorState';
import { AvlStateMachine } from '../../avl/molecules/AvlStateMachine';
import { traitLevelFromTrait } from '../../../lib/avl-schema-parser';
import { useTranslate } from '../../../core';
import { cn } from '../../../core';
import type { OrbitalSchema, Trait, A11yProps } from '@almadar/core';
import { isInlineTrait } from '@almadar/core';
import type { UiError } from '../../../core';

import { domPassthrough } from '../../../core';
export interface JazariStateMachineProps extends A11yProps {
  /** Additional CSS classes */
  className?: string;
  /** Loading state indicator */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
  /** Full schema — extracts first trait's state machine */
  schema?: OrbitalSchema;
  /** Or pass a single trait directly */
  trait?: Trait;
  /** Which trait to visualize (default: 0) */
  traitIndex?: number;
  /** Override entity field labels */
  entityFields?: string[];
  /** Text direction (default: 'ltr') */
  direction?: 'ltr' | 'rtl';
}

function extractTrait(schema: OrbitalSchema | undefined, trait: Trait | undefined, traitIndex: number): Trait | null {
  if (trait) return trait;
  if (!schema?.orbitals?.length) return null;
  for (const orbital of schema.orbitals) {
    const traits = orbital.traits ?? [];
    if (traitIndex < traits.length) {
      const traitRef = traits[traitIndex];
      return isInlineTrait(traitRef) ? traitRef : null;
    }
  }
  return null;
}

function firstEntity(schema: OrbitalSchema | undefined): { name: string; fields: string[] } | null {
  const entity = schema?.orbitals?.[0]?.entity;
  if (!entity || typeof entity !== 'object' || !('fields' in entity) || typeof entity.name !== 'string') return null;
  const fields = (entity.fields ?? []).map((f) => f.name).filter((n): n is string => typeof n === 'string' && n.length > 0);
  return { name: entity.name, fields };
}

export const JazariStateMachine: React.FC<JazariStateMachineProps> = ({
  schema,
  trait: traitProp,
  traitIndex = 0,
  entityFields: entityFieldsProp,
  direction = 'ltr',
  className,
  isLoading = false,
  error = null,
  ...rest
}) => {
  const { t } = useTranslate();

  const entity = useMemo(() => firstEntity(schema), [schema]);
  const entityFields = useMemo(() => entityFieldsProp ?? entity?.fields ?? [], [entityFieldsProp, entity]);
  const traitData = useMemo(() => {
    const trait = extractTrait(schema, traitProp, traitIndex);
    return trait ? traitLevelFromTrait(trait, entity?.name ?? '') : null;
  }, [schema, traitProp, traitIndex, entity]);

  if (isLoading) {
    return <LoadingState {...domPassthrough(rest)} message={t('stateMachine.loading')} />;
  }

  if (error) {
    return <ErrorState {...domPassthrough(rest)} message={error instanceof Error ? error.message : String(error)} />;
  }

  if (!traitData || traitData.states.length === 0) {
    return (
      <Box {...domPassthrough(rest)} padding="lg" className={cn('text-center', className)}>
        <Typography variant="body" color="muted">
          {t('stateMachine.noStateMachine')}
        </Typography>
      </Box>
    );
  }

  return (
    <AvlStateMachine
      {...domPassthrough(rest)}
      trait={traitData}
      nodeShape="gear"
      direction={direction}
      entityFields={entityFields}
      className={cn('jazari-state-machine', className)}
    />
  );
};

JazariStateMachine.displayName = 'JazariStateMachine';
