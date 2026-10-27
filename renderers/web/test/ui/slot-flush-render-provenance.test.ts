/**
 * Render provenance on the response path (G-RUNTIME-046): a render effect
 * tagged with the transition that fired (`event`, `fromState`) reaches the
 * slot content, so the rendered DOM carries `data-orb-transition` — what the
 * live preview's inline text editing addresses an edit by. An untagged entry
 * (an older server) still renders, just without it.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ClientEffectByTrait } from '@almadar/core';
import { useSlotFlush } from '../../src/hooks/circuit/useSlotFlush';
import type { UISlotManager } from '../../src/hooks/useUISlots';

function stubSlots(): UISlotManager & { render: ReturnType<typeof vi.fn>; updateTraitContent: ReturnType<typeof vi.fn> } {
  return {
    slots: {},
    render: vi.fn(() => 'id'),
    clear: vi.fn(),
    clearBySource: vi.fn(),
    clearById: vi.fn(),
    clearAll: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    hasContent: vi.fn(() => false),
    getContent: vi.fn(() => null),
    getTraitContent: vi.fn(() => null),
    subscribeTrait: vi.fn(() => () => undefined),
    updateTraitContent: vi.fn(() => 'id'),
  };
}

const tagged: ClientEffectByTrait = {
  traitName: 'WidgetInteraction',
  effect: ['render-ui', 'main', { type: 'typography', content: 'Hello' }],
  event: 'INIT',
  fromState: 'Browsing',
};

describe('applyClientEffects carries render provenance', () => {
  it('a tagged render reaches its slot with the transition and from-state', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, undefined));
    result.current.applyClientEffects([tagged]);
    expect(slots.render).toHaveBeenCalledWith(expect.objectContaining({
      target: 'main', sourceTrait: 'WidgetInteraction', transitionEvent: 'INIT', fromState: 'Browsing',
    }));
  });

  it('an embedded trait keeps it in its frame too', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, new Set(['WidgetInteraction'])));
    result.current.applyClientEffects([tagged]);
    expect(slots.updateTraitContent).toHaveBeenCalledWith('WidgetInteraction', expect.objectContaining({ transitionEvent: 'INIT', fromState: 'Browsing' }));
  });

  it('an embedded frame names the slot its trait rendered into, on both flush paths', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, new Set(['WidgetInteraction'])));
    result.current.applyClientEffects([{ ...tagged, effect: ['render-ui', 'sidebar', { type: 'typography', content: 'Hi' }] }]);
    result.current.flushSlot('WidgetInteraction', 'sidebar', [{ pattern: { type: 'typography', content: 'Hi' }, props: {} }], { event: 'INIT' });
    expect(slots.updateTraitContent).toHaveBeenNthCalledWith(1, 'WidgetInteraction', expect.objectContaining({ slot: 'sidebar' }));
    expect(slots.updateTraitContent).toHaveBeenNthCalledWith(2, 'WidgetInteraction', expect.objectContaining({ slot: 'sidebar' }));
  });

  it('an untagged render (an older server) still renders, without provenance', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, undefined));
    result.current.applyClientEffects([{ traitName: tagged.traitName, effect: tagged.effect }]);
    const content = slots.render.mock.calls[0][0];
    expect(content).toEqual(expect.objectContaining({ target: 'main', sourceTrait: 'WidgetInteraction' }));
    expect(content.transitionEvent).toBeUndefined();
    expect(content.fromState).toBeUndefined();
  });

  it('two traits in one response each keep their own transition', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, undefined));
    result.current.applyClientEffects([
      tagged,
      { traitName: 'Listener', effect: ['render-ui', 'sidebar', { type: 'badge', label: 'n' }], event: 'ITEMS_LOADED', fromState: 'idle' },
    ]);
    expect(slots.render).toHaveBeenNthCalledWith(2, expect.objectContaining({ sourceTrait: 'Listener', transitionEvent: 'ITEMS_LOADED', fromState: 'idle' }));
  });
});
