'use client';

/**
 * BehaviorView — an orbital's behavior: one themed state machine per trait.
 */

import React from 'react';
import type { A11yProps } from '@almadar/core';
import { Box } from '../../../core';
import { EmptyState } from '../../core/molecules/EmptyState';
import { domPassthrough } from '../../../core';
import { useTranslate } from '../../../core';
import { AvlStateMachine } from './AvlStateMachine';
import { type AvlNodeData } from '../../../lib/avl-flow-converter';

export interface BehaviorViewProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** The orbital to summarize.
   * @example {"orbitalName":"OrderOrbital","entityName":"Order","persistence":"persistent","fields":[{"name":"customer","type":"string","required":true,"hasDefault":false},{"name":"qty","type":"number","required":true,"hasDefault":true},{"name":"status","type":"string","required":false,"hasDefault":true}],"traits":[{"name":"OrderFlow","stateCount":5,"eventCount":7,"transitionCount":7,"emits":["ORDER_SAVED"],"listens":["PAYMENT_OK"]}],"pages":[{"name":"Orders","route":"/orders"}],"traitDetails":{"OrderFlow":{"name":"OrderFlow","linkedEntity":"Order","states":[{"name":"browsing","isInitial":true,"isTerminal":false},{"name":"editing","isInitial":false,"isTerminal":false},{"name":"saving","isInitial":false,"isTerminal":false},{"name":"confirmed","isInitial":false,"isTerminal":true},{"name":"failed","isInitial":false,"isTerminal":false}],"transitions":[{"from":"browsing","to":"editing","event":"EDIT","effects":[{"type":"render-ui","args":[]}],"index":0},{"from":"editing","to":"saving","event":"SAVE","effects":[{"type":"persist","args":[]},{"type":"notify","args":[]}],"index":1},{"from":"saving","to":"confirmed","event":"SAVED","effects":[{"type":"emit","args":[]},{"type":"render-ui","args":[]}],"index":2},{"from":"saving","to":"failed","event":"SAVE_FAILED","effects":[{"type":"notify","args":[]}],"index":3},{"from":"failed","to":"editing","event":"RETRY","effects":[],"index":4},{"from":"editing","to":"browsing","event":"CANCEL","effects":[{"type":"render-ui","args":[]}],"index":5},{"from":"confirmed","to":"browsing","event":"DONE","effects":[{"type":"navigate","args":[]}],"index":6}],"emittedEvents":["ORDER_SAVED"],"listenedEvents":["PAYMENT_OK"]}},"externalLinks":[{"targetOrbital":"PaymentOrbital","eventName":"PAYMENT_OK","direction":"in","traitName":"OrderFlow"}]}
   */
  data: AvlNodeData;
}

export const BehaviorView: React.FC<BehaviorViewProps> = ({ data, ...rest }) => {
  const { t } = useTranslate();
  const details = data.traits.map((tr) => data.traitDetails[tr.name]).filter((d) => d !== undefined);

  if (details.length === 0) {
    return (
      <Box {...domPassthrough(rest)} data-testid="behavior-view-empty">
        <EmptyState icon="workflow" title={t('avl.noTraitData')} />
      </Box>
    );
  }

  return (
    <Box {...domPassthrough(rest)} className="flex flex-col gap-4" style={{ width: '100%' }}>
      {details.map((trait) => (
        <Box
          key={trait.name}
          className="rounded-lg border px-5 pb-4 pt-4"
          style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-sm)' }}
        >
          <AvlStateMachine trait={trait} />
        </Box>
      ))}
    </Box>
  );
};

BehaviorView.displayName = 'BehaviorView';
