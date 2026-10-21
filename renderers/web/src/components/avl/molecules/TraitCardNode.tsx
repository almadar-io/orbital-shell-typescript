'use client';

/**
 * TraitCardNode — React Flow node for the `trait-expanded` view level: one
 * card per trait, its state machine drawn by `AvlStateMachine`. A transition
 * click drills into L4 through `TraitCardSelectionContext`; a played scene in
 * the same context lights the machine (active state, fired transition, path).
 * Left handles are the trait's listens, right handles its emits.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { OrbitalSchema } from '@almadar/core';
import { Box } from '../../../core';
import { HStack, VStack } from '../../../core';
import { Typography } from '../../../core';
import { Badge } from '../../../core';
import { AvlStateMachine } from './AvlStateMachine';
import { parseTraitLevel } from '../../../lib/avl-schema-parser';
import { stateMachinePlayback, type AvlPlayStep } from '../../../lib/avl-play';
import { useTranslate } from '../../../core';
import { type PreviewNodeData } from '../../../lib/avl-preview-converter';

// ---------------------------------------------------------------------------
// Selection context
// ---------------------------------------------------------------------------

export interface TraitCardTransitionClick {
  orbitalName: string;
  traitName: string;
  transitionEvent: string;
  fromState: string;
  toState: string;
  index: number;
}

export interface TraitCardSelectionContextValue {
  selectTransition: (sel: TraitCardTransitionClick) => void;
  /** Played steps and the step shown (index), lighting each card's machine. */
  scene?: { steps: readonly AvlPlayStep[]; cursor: number };
}

export const TraitCardSelectionContext = createContext<TraitCardSelectionContextValue>({
  selectTransition: () => { /* no-op default; FlowCanvas wraps consumers */ },
});

// ---------------------------------------------------------------------------
// Node component
// ---------------------------------------------------------------------------

const CARD_WIDTH = 540;

const TraitCardNodeInner: React.FC<NodeProps> = (props) => {
  const data = props.data as PreviewNodeData;
  const { t } = useTranslate();
  const { selectTransition, scene } = useContext(TraitCardSelectionContext);

  const orbitalName = data.orbitalName;
  const traitName = data.traitName ?? '';
  const linkedEntity = data.linkedEntity ?? '';
  const emits = data.emits ?? [];
  const listens = data.listens ?? [];
  const fullSchema = data._fullSchema as OrbitalSchema | undefined;

  const traitLevelData = useMemo(() => {
    if (!fullSchema) return null;
    return parseTraitLevel(fullSchema, orbitalName, traitName);
  }, [fullSchema, orbitalName, traitName]);

  const playback = useMemo(
    () => (traitLevelData && scene ? stateMachinePlayback(traitLevelData, orbitalName, scene.steps, scene.cursor) : null),
    [traitLevelData, scene, orbitalName],
  );

  return (
    <Box
      className="bg-card border-2 border-border rounded-lg shadow-md p-4"
      style={{ width: CARD_WIDTH, position: 'relative' }}
    >
      {listens.map((event, i) => (
        <Handle
          key={`listen-${event}`}
          type="target"
          position={Position.Left}
          id={`listen-${event}`}
          style={{ top: `${((i + 1) / (listens.length + 1)) * 100}%` }}
          aria-label={t('avl.listensFor', { event })}
        />
      ))}
      {emits.map((event, i) => (
        <Handle
          key={`emit-${event}`}
          type="source"
          position={Position.Right}
          id={`emit-${event}`}
          style={{ top: `${((i + 1) / (emits.length + 1)) * 100}%` }}
          aria-label={t('avl.emits', { event })}
        />
      ))}

      <VStack gap="sm">
        <HStack gap="xs" justify="between" align="center">
          <Typography variant="h6">{traitName}</Typography>
          {linkedEntity ? <Badge variant="secondary">{linkedEntity}</Badge> : null}
        </HStack>

        {traitLevelData ? (
          // xyflow skips drag/pan/wheel on these classes, so label clicks reach the machine.
          <Box className="nodrag nopan nowheel">
            <AvlStateMachine
              trait={traitLevelData}
              showHeader={false}
              activeState={playback?.activeState}
              activeTransition={playback?.activeTransition}
              visitedStates={playback?.visitedStates}
              onTransitionClick={(tr) => selectTransition({
                orbitalName,
                traitName,
                transitionEvent: tr.event,
                fromState: tr.from,
                toState: tr.to,
                index: tr.index,
              })}
            />
          </Box>
        ) : (
          <Typography variant="small" color="muted">{t('avl.noStateMachine')}</Typography>
        )}
      </VStack>
    </Box>
  );
};

export const TraitCardNode = React.memo(TraitCardNodeInner);
TraitCardNode.displayName = 'TraitCardNode';
