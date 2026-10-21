'use client';

/**
 * Avl3DTraitScene - 3D state machine view for a single trait.
 *
 * Positions states on a fibonacci sphere and renders transition arcs
 * between them. The 3D equivalent of AvlTraitScene.
 *
 * @packageDocumentation
 */

import React, { useMemo } from 'react';
import type { TraitLevelData } from '../../../lib/avl-schema-parser';
import { fibonacciSpherePositions } from '../../../lib/avl-3d-layout';
import { Avl3DStateNode } from '../molecules/Avl3DStateNode';
import { Avl3DTransitionArc } from '../molecules/Avl3DTransitionArc';
import { Avl3DLabel } from '../atoms/Avl3DLabel';
import { AVL_INK } from '../../../lib/avl-theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Avl3DTraitSceneProps {
  /** Parsed trait-level data */
  data: TraitLevelData;
  /** Click handler for a transition */
  onTransitionClick?: (transitionIndex: number) => void;
  /** Primary color */
  color?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Avl3DTraitScene: React.FC<Avl3DTraitSceneProps> = ({
  data,
  onTransitionClick,
}) => {
  // Position states on a fibonacci sphere
  const statePositions = useMemo(() => {
    const radius = Math.max(3, data.states.length * 0.8);
    const positions = fibonacciSpherePositions(data.states.length, radius);
    const posMap = new Map<string, [number, number, number]>();

    data.states.forEach((state, i) => {
      const pos = positions[i];
      posMap.set(state.name, [pos.x, pos.y, pos.z]);
    });

    return posMap;
  }, [data.states]);

  // Track parallel transition indices between same state pairs
  const transitionIndices = useMemo(() => {
    const pairCount = new Map<string, number>();
    return data.transitions.map((t) => {
      const key = `${t.from}->${t.to}`;
      const idx = pairCount.get(key) ?? 0;
      pairCount.set(key, idx + 1);
      return idx;
    });
  }, [data.transitions]);

  // Compute incoming/outgoing transition counts per state (for tooltips)
  const transitionCounts = useMemo(() => {
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    for (const t of data.transitions) {
      outgoing.set(t.from, (outgoing.get(t.from) ?? 0) + 1);
      incoming.set(t.to, (incoming.get(t.to) ?? 0) + 1);
    }
    return { incoming, outgoing };
  }, [data.transitions]);

  return (
    <group>
      {/* Trait name */}
      <Avl3DLabel
        position={[0, 5, 0]}
        text={`${data.name} (${data.linkedEntity})`}
        color={AVL_INK.text}
        fontSize={14}
      />

      {/* State nodes */}
      {data.states.map((state) => {
        const pos = statePositions.get(state.name);
        if (!pos) return null;

        return (
          <Avl3DStateNode
            key={state.name}
            name={state.name}
            isInitial={state.isInitial ?? undefined}
            isTerminal={state.isTerminal ?? undefined}
            position={pos}
            incomingCount={transitionCounts.incoming.get(state.name) ?? 0}
            outgoingCount={transitionCounts.outgoing.get(state.name) ?? 0}
          />
        );
      })}

      {/* Transition arcs */}
      {data.transitions.map((transition, i) => {
        const fromPos = statePositions.get(transition.from);
        const toPos = statePositions.get(transition.to);
        if (!fromPos || !toPos) return null;

        const isSelf = transition.from === transition.to;

        return (
          <Avl3DTransitionArc
            key={`${transition.from}-${transition.event}-${transition.to}-${i}`}
            from={fromPos}
            to={toPos}
            event={transition.event}
            hasGuard={!!transition.guard}
            effectCount={transition.effects?.length ?? 0}
            effectTypes={transition.effects?.map((e) => {
              if (Array.isArray(e)) return String(e[0]);
              return typeof e === 'string' ? e : 'unknown';
            })}
            index={transitionIndices[i]}
            isSelf={isSelf}
            fromState={transition.from}
            toState={transition.to}
            onClick={() => onTransitionClick?.(i)}
          />
        );
      })}
    </group>
  );
};

Avl3DTraitScene.displayName = 'Avl3DTraitScene';
