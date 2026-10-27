// @vitest-environment jsdom
/**
 * Paint-local-first rollback: a checkpoint taken before a locally-painted
 * dispatch restores exactly what each (slot, trait) held when its server leg
 * fails — a prior render is re-applied, a slot that held nothing is cleared.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import type { ClientEffectTuple } from '@almadar/core';
import { EventBusProvider } from '../../src/core';
import { UISlotProvider, useUISlots } from '../../src/providers/UISlotContext';
import { useSlotFlush, type SlotFlushHandle } from '../../src/hooks/circuit/useSlotFlush';
import type { UISlotManager } from '../../src/hooks/useUISlots';

function Grab({ onReady }: { onReady: (flush: SlotFlushHandle, slots: UISlotManager) => void }): null {
  const slots = useUISlots();
  const flush = useSlotFlush(slots, undefined);
  onReady(flush, slots);
  return null;
}

function harness() {
  let flush!: SlotFlushHandle;
  let slots!: UISlotManager;
  render(
    <EventBusProvider isolated>
      <UISlotProvider>
        <Grab onReady={(f, s) => { flush = f; slots = s; }} />
      </UISlotProvider>
    </EventBusProvider>,
  );
  return { flush: () => flush, slots: () => slots };
}

const renderMain = (type: 'typography' | 'skeleton', trait = 'Browse'): Array<{ effect: ClientEffectTuple; traitName: string }> => [
  {
    effect: type === 'typography'
      ? ['render-ui', 'main', { type: 'typography', content: 'loaded' }]
      : ['render-ui', 'main', { type: 'skeleton', variant: 'table' }],
    traitName: trait,
  },
];

describe('useSlotFlush checkpoint / rollback', () => {
  it('rolls a locally-painted skeleton back to the content the slot held before', () => {
    const h = harness();
    act(() => { h.flush().applyClientEffects(renderMain('typography')); });
    const cp = h.flush().checkpoint();
    act(() => { h.flush().applyClientEffects(renderMain('skeleton')); });
    expect(h.slots().slots.main?.pattern).toBe('skeleton');
    act(() => { h.flush().rollback(cp); });
    expect(h.slots().slots.main?.pattern).toBe('typography');
  });

  it('a slot that held nothing before the paint is cleared on rollback', () => {
    const h = harness();
    const cp = h.flush().checkpoint();
    act(() => { h.flush().applyClientEffects(renderMain('skeleton')); });
    act(() => { h.flush().rollback(cp); });
    expect(h.slots().slots.main ?? null).toBeNull();
  });

  it('control: rolling back to a checkpoint with no writes since changes nothing', () => {
    const h = harness();
    act(() => { h.flush().applyClientEffects(renderMain('typography')); });
    const cp = h.flush().checkpoint();
    act(() => { h.flush().rollback(cp); });
    expect(h.slots().slots.main?.pattern).toBe('typography');
  });

  it('edge: another trait\'s write in the same slot is restored independently', () => {
    const h = harness();
    act(() => { h.flush().applyClientEffects(renderMain('typography', 'Header')); });
    const cp = h.flush().checkpoint();
    act(() => { h.flush().applyClientEffects(renderMain('skeleton', 'Browse')); });
    act(() => { h.flush().rollback(cp); });
    expect(h.slots().slots.main?.pattern).toBe('typography');
    expect(h.slots().slots.main?.sourceTrait).toBe('Header');
  });
});
