'use client';

/**
 * ModuleCard — Structured card for the module zoom band (0.4x-1.0x).
 *
 * Renders AVL primitives inside a card container:
 * - Entity section: AvlEntity glyph + AvlPersistence + AvlFieldType grid
 * - Trait sections: MiniStateMachine per trait + AvlEffect icons + emit/listen indicators
 * - Pages section: AvlPage squares with route labels
 */

import React from 'react';
import { domPassthrough } from '../../../core';
import { Handle, Position, useNodeId, ReactFlowProvider } from '@xyflow/react';
import { AvlEntity } from '../atoms/AvlEntity';
import { AvlFieldType } from '../atoms/AvlFieldType';
import { AvlPage } from '../atoms/AvlPage';
import { MiniStateMachine } from './MiniStateMachine';
import { AvlExplain } from './AvlExplain';
import { Box } from '../../../core';
import type { AvlAnnotations } from '../../../lib/avl-annotations';
import { CONNECTION_COLORS } from '../../../lib/avl-theme';
import { type FieldType, type EntityPersistence, type A11yProps } from '@almadar/core';
import { type AvlNodeData } from '../../../lib/avl-flow-converter';

/**
 * ModuleCard — a compact summary card for one orbital module: its entity and
 * fields, a mini state machine per trait, and its pages.
 *
 * @capabilities orbital module summary card, entity and trait overview card, app architecture node card
 */
export interface ModuleCardProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** The orbital to summarize.
   * @example {"orbitalName":"OrderOrbital","entityName":"Order","persistence":"persistent","fields":[{"name":"customer","type":"string","required":true,"hasDefault":false},{"name":"qty","type":"number","required":true,"hasDefault":true},{"name":"status","type":"string","required":false,"hasDefault":true}],"traits":[{"name":"OrderFlow","stateCount":5,"eventCount":7,"transitionCount":7,"emits":["ORDER_SAVED"],"listens":["PAYMENT_OK"]}],"pages":[{"name":"Orders","route":"/orders"}],"traitDetails":{"OrderFlow":{"name":"OrderFlow","linkedEntity":"Order","states":[{"name":"browsing","isInitial":true,"isTerminal":false},{"name":"editing","isInitial":false,"isTerminal":false},{"name":"saving","isInitial":false,"isTerminal":false},{"name":"confirmed","isInitial":false,"isTerminal":true},{"name":"failed","isInitial":false,"isTerminal":false}],"transitions":[{"from":"browsing","to":"editing","event":"EDIT","effects":[{"type":"render-ui","args":[]}],"index":0},{"from":"editing","to":"saving","event":"SAVE","effects":[{"type":"persist","args":[]},{"type":"notify","args":[]}],"index":1},{"from":"saving","to":"confirmed","event":"SAVED","effects":[{"type":"emit","args":[]},{"type":"render-ui","args":[]}],"index":2},{"from":"saving","to":"failed","event":"SAVE_FAILED","effects":[{"type":"notify","args":[]}],"index":3},{"from":"failed","to":"editing","event":"RETRY","effects":[],"index":4},{"from":"editing","to":"browsing","event":"CANCEL","effects":[{"type":"render-ui","args":[]}],"index":5},{"from":"confirmed","to":"browsing","event":"DONE","effects":[{"type":"navigate","args":[]}],"index":6}],"emittedEvents":["ORDER_SAVED"],"listenedEvents":["PAYMENT_OK"]}},"externalLinks":[{"targetOrbital":"PaymentOrbital","eventName":"PAYMENT_OK","direction":"in","traitName":"OrderFlow"}]}
   */
  data: AvlNodeData;
  /** Author explanations per trait name (states, transition events, effect types), shown in a popover on hover.
   * @example {"OrderFlow":{"states":{"saving":{"body":"Waiting for the server to confirm."}},"effects":{"persist":{"body":"Saves the order."}}}}
   */
  annotations?: Record<string, AvlAnnotations>;
}

function toFieldKind(type: string): FieldType {
  const normalized = type.toLowerCase();
  if (['string', 'number', 'boolean', 'date', 'enum', 'object', 'array'].includes(normalized)) {
    return normalized as FieldType;
  }
  return 'string';
}

const PERSISTENCE_BORDER: Record<string, string> = {
  persistent: 'border-l-[3px] border-l-primary border-solid',
  runtime: 'border-l-[3px] border-l-primary border-dashed',
  singleton: 'border-l-[3px] border-l-primary border-double',
  instance: 'border-l-[3px] border-l-primary border-dotted',
};

const PERSISTENCE_ICON: Record<string, string> = {
  persistent: '\u26C1', // ⛁ cylinder
  runtime: '\u27F3',    // ⟳ cycle
  singleton: '\u25CE',  // ◎ double ring
  instance: '\u22A1',   // ⊡ box
};

const ModuleCardInner: React.FC<ModuleCardProps> = ({ data, annotations, ...rest }) => {
  const {
    orbitalName,
    entityName,
    persistence,
    fields,
    traits,
    pages,
    traitDetails,
    externalLinks,
  } = data;

  const cols = Math.min(3, Math.max(2, Math.ceil(fields.length / 3)));

  return (
    <div
      {...domPassthrough(rest)}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm overflow-hidden"
      style={{ minWidth: 280, maxWidth: 400 }}
    >
      {/* Handles for event wire connections */}
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-warning" />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-warning" />

      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--color-border)]">
        <span className="text-base font-bold text-[var(--color-foreground)]">{orbitalName}</span>
      </div>

      {/* Entity section */}
      <div className={`px-3 py-2 border-b border-[var(--color-border)] ${PERSISTENCE_BORDER[persistence] ?? ''}`}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <svg width={18} height={18} viewBox="0 0 20 20">
            <AvlEntity x={10} y={10} r={8} persistence={persistence as EntityPersistence} />
          </svg>
          <span className="text-sm font-semibold text-[var(--color-foreground)]">{entityName}</span>
          <span className="ml-auto text-xs opacity-50" title={persistence}>
            {PERSISTENCE_ICON[persistence] ?? ''}
          </span>
        </div>

        {/* Field type grid */}
        {fields.length > 0 && (
          <div className={`grid gap-x-3 gap-y-0.5`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {fields.map(f => (
              <div key={f.name} className="flex items-center gap-1">
                <AvlExplain lines={[f.name, f.type]}>
                  <Box as="span" role="img" tabIndex={0} aria-label={`${f.name}: ${f.type}`} className="inline-flex cursor-help rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
                      <AvlFieldType x={8} y={8} kind={toFieldKind(f.type)} size={6} />
                    </svg>
                  </Box>
                </AvlExplain>
                <span className="text-xs text-[var(--color-muted-foreground)] truncate">{f.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Trait sections */}
      {traits.map(trait => {
        const detail = traitDetails[trait.name];
        const traitEmits = externalLinks.filter(l => l.direction === 'out' && l.traitName === trait.name);
        const traitListens = externalLinks.filter(l => l.direction === 'in' && l.traitName === trait.name);

        return (
          <div key={trait.name} className="px-3 py-2 border-b border-[var(--color-border)]">
            <div className="text-xs font-semibold text-[var(--color-foreground)] mb-1">{trait.name}</div>

            {/* Mini state machine */}
            {detail && <MiniStateMachine data={detail} annotations={annotations?.[trait.name]} className="mb-1" />}

            {/* Emit/Listen indicators */}
            {(traitEmits.length > 0 || traitListens.length > 0) && (
              <div className="flex items-center gap-2 text-[9px] mt-1">
                {traitListens.map(l => (
                  <span key={l.eventName} style={{ color: CONNECTION_COLORS.emitListen.color }}>
                    {'◀~~'} {l.eventName}
                  </span>
                ))}
                {traitListens.length > 0 && traitEmits.length > 0 && <span className="flex-1" />}
                {traitEmits.map(l => (
                  <span key={l.eventName} style={{ color: CONNECTION_COLORS.emitListen.color }} className="ml-auto">
                    {l.eventName} {'~~▶'}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Pages section */}
      {pages.length > 0 && (
        <div className="px-3 py-1.5 flex items-center gap-2 flex-wrap">
          {pages.map(p => (
            <div key={p.name} className="flex items-center gap-0.5">
              <svg width={10} height={10} viewBox="0 0 12 12">
                <AvlPage x={6} y={6} size={5} />
              </svg>
              <span className="text-xs font-mono text-[var(--color-muted-foreground)]">{p.route}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

ModuleCardInner.displayName = 'ModuleCardInner';

/**
 * Self-contained ModuleCard. The connection `<Handle>`s need the ReactFlow store,
 * so standalone they'd throw ("no zustand provider as an ancestor"). When this
 * card isn't already a flow node (`useNodeId() === null`) it bundles its own
 * `<ReactFlowProvider>` so it renders anywhere; inside `<FlowCanvas>` it's a real
 * node and renders raw (no nested provider). The provider is an implementation
 * detail, never a precondition for using the component.
 */
export const ModuleCard: React.FC<ModuleCardProps> = (props) => {
  const nodeId = useNodeId();
  if (nodeId !== null) return <ModuleCardInner {...props} />;
  return (
    <ReactFlowProvider>
      <ModuleCardInner {...props} />
    </ReactFlowProvider>
  );
};

ModuleCard.displayName = 'ModuleCard';
