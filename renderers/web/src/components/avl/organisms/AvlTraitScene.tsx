'use client';

/**
 * AvlTraitScene V2 - Zoom Level 3
 *
 * Left-to-right horizontal flow with color-coded states,
 * transition lanes, and swim lanes for emit/listen events.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { createLogger } from '@almadar/logger';
import { useTranslate } from '../../../core';
import { AvlState } from '../atoms/AvlState';

const log = createLogger('almadar:ui:avl:trait-scene');
import { AvlTransitionLane } from '../molecules/AvlTransitionLane';
import { AvlSwimLane } from '../molecules/AvlSwimLane';
import { AvlClickTarget } from './AvlClickTarget';
import { computeTraitLayout, edgePath, type ElkLayout } from '../../../lib/avl-elk-layout';
import type { TraitLevelData } from '../../../lib/avl-schema-parser';
import { CONNECTION_COLORS } from '../../../lib/avl-theme';

export interface AvlTraitSceneProps {
  data: TraitLevelData;
  color?: string;
  onTransitionClick?: (transitionIndex: number, position: { x: number; y: number }) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SWIM_GUTTER = 120;
const CENTER_W = 360;

export const AvlTraitScene: React.FC<AvlTraitSceneProps> = ({
  data,
  color = 'var(--color-primary)',
  onTransitionClick,
}) => {
  const { t } = useTranslate();
  const [layout, setLayout] = useState<ElkLayout | null>(null);
  const dataKey = useMemo(() => JSON.stringify(data), [data]);

  useEffect(() => {
    computeTraitLayout(data).then(setLayout).catch((error) => {
      log.error('computeTraitLayout failed', { error: error instanceof Error ? error : String(error) });
    });
  }, [dataKey]);

  if (!layout) {
    return (
      <g>
        <text x={300} y={200} textAnchor="middle" fill={color} fontSize={12} opacity={0.5}>
          {t('avl.computingLayout')}
        </text>
      </g>
    );
  }

  const hasExternal = data.listenedEvents.length > 0 || data.emittedEvents.length > 0;
  const viewW = hasExternal ? SWIM_GUTTER + CENTER_W + SWIM_GUTTER : CENTER_W + 60;
  const machineOffsetX = hasExternal ? 0 : 30;

  // Scale the ELK layout to fit the center area
  const padding = 20;
  const availW = CENTER_W - padding * 2;
  const availH = 300;
  const scale = Math.min(1, availW / layout.width, availH / layout.height);
  const scaledW = layout.width * scale;
  const scaledH = layout.height * scale;
  const offsetX = padding + (availW - scaledW) / 2;
  const offsetY = 50 + (availH - scaledH) / 2;

  const machineHeight = scaledH + 100;

  const renderMachine = (
    <g>
      {/* Trait label */}
      <text x={CENTER_W / 2} y={20} textAnchor="middle" fill={color} fontSize={20} fontWeight="700" fontFamily="inherit">
        {data.name}
      </text>
      <text x={CENTER_W / 2} y={38} textAnchor="middle" fill={color} fontSize={11} opacity={0.5} fontFamily="inherit">
        {t('avl.linkedTo', { entity: data.linkedEntity })}
      </text>

      {/* Arrow markers */}
      <defs>
        <marker id="traitArrowV2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={CONNECTION_COLORS.forward.color} opacity={0.7} />
        </marker>
        <marker id="traitArrowBack" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={CONNECTION_COLORS.backward.color} opacity={0.5} />
        </marker>
      </defs>

      <g transform={`translate(${offsetX},${offsetY}) scale(${scale})`}>
        {/* Edge paths */}
        {layout.edges.map((edge) => {
          const conn = edge.isSelf
            ? CONNECTION_COLORS.selfLoop
            : edge.isBackward
              ? CONNECTION_COLORS.backward
              : CONNECTION_COLORS.forward;
          const marker = edge.isBackward || edge.isSelf ? 'url(#traitArrowBack)' : 'url(#traitArrowV2)';

          return (
            <g key={edge.id}>
              <path
                d={edgePath(edge.points)}
                fill="none"
                stroke={conn.color}
                strokeWidth={conn.width}
                strokeDasharray={conn.dash === 'none' ? undefined : conn.dash}
                opacity={0.5}
                markerEnd={marker}
              />

              {/* Transition lane at label position */}
              <AvlTransitionLane
                x={edge.labelX}
                y={edge.labelY}
                event={edge.event}
                guard={edge.guardExpr}
                effects={edge.effects.map(e => ({ type: e.type }))}
                width={edge.labelW}
                isBackward={edge.isBackward}
                isSelfLoop={edge.isSelf}
                color={color}
                onTransitionClick={onTransitionClick
                  ? () => onTransitionClick(edge.index, {
                    x: edge.labelX + offsetX + (hasExternal ? SWIM_GUTTER : machineOffsetX),
                    y: edge.labelY + offsetY,
                  })
                  : undefined
                }
              />
            </g>
          );
        })}

        {/* State nodes */}
        {layout.nodes.map((node) => (
          <g key={node.id}>
            <AvlState
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              name={node.id}
              isInitial={node.isInitial}
              isTerminal={node.isTerminal}
              role={node.role}
              transitionCount={node.transitionCount}
              color={color}
            />
          </g>
        ))}
      </g>
    </g>
  );

  if (!hasExternal) {
    return <g transform={`translate(${machineOffsetX}, 0)`}>{renderMachine}</g>;
  }

  return (
    <AvlSwimLane
      listenedEvents={data.listenedEvents}
      emittedEvents={data.emittedEvents}
      centerWidth={CENTER_W}
      height={machineHeight}
      color={color}
    >
      {renderMachine}
    </AvlSwimLane>
  );
};

AvlTraitScene.displayName = 'AvlTraitScene';
