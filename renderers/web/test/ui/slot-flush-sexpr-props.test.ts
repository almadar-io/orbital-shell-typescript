/**
 * A server-applied render effect must keep a pattern's sexpr-typed props
 * (an action's `when`) as data. Without the pattern type the fn-form
 * converter compiled `when` into a React render function, so a root
 * detail-panel's status-gated actions all evaluated false and vanished.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSlotFlush } from '../../src/hooks/circuit/useSlotFlush';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import type { ClientEffectTuple } from '@almadar/core';

function stubSlots(): UISlotManager & { render: ReturnType<typeof vi.fn> } {
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

const when = ['fn', 'row', ['=', ['object/get', '@row', 'status'], 'draft']];

describe('useSlotFlush.applyClientEffects — sexpr-typed props', () => {
  it("keeps a root detail-panel action's `when` as its S-expression", () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, undefined));
    const effect: ClientEffectTuple = ['render-ui', 'main', {
      type: 'detail-panel',
      fields: ['name'],
      actions: [{ label: 'Submit', event: 'SUBMIT', when }],
    }];
    result.current.applyClientEffects([], [{ traitName: 'Ledger', effect }]);
    const props = slots.render.mock.calls[0][0].props;
    expect(props.actions[0].when).toEqual(when);
  });

  it('control: a render-function prop (renderItem) is still compiled', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, undefined));
    // Wire-shaped, exactly as a server response carries it.
    const effect: ClientEffectTuple = JSON.parse(
      '["render-ui","main",{"type":"data-grid","fields":["name"],"renderItem":["fn","item",{"type":"typography","content":"@item.name"}]}]',
    );
    result.current.applyClientEffects([], [{ traitName: 'Grid', effect }]);
    expect(typeof slots.render.mock.calls[0][0].props.renderItem).toBe('function');
  });
});
