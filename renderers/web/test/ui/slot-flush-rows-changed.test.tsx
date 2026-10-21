/**
 * EXEC-RENDER-3 at the flush: a render effect flagged `repaint: "rows-changed"` re-resolves the row-set
 * references it holds; an unflagged repaint of the same content does not.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ROW_SET_MARKER, type ClientEffectByTrait, type PatternConfig } from '@almadar/core';
import { useSlotFlush } from '../../src/hooks/circuit/useSlotFlush';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import { RowSetResolverProvider } from '../../src/providers/RowSetResolverContext';
import type { RowSetResolver } from '../../src/lib/row-set-resolver';

const slots: UISlotManager = {
  slots: {}, render: vi.fn(() => 'id'), clear: vi.fn(), clearBySource: vi.fn(), clearById: vi.fn(), clearAll: vi.fn(),
  subscribe: vi.fn(() => () => undefined), hasContent: vi.fn(() => false), getContent: vi.fn(() => null),
  getTraitContent: vi.fn(() => null), subscribeTrait: vi.fn(() => () => undefined), updateTraitContent: vi.fn(() => 'id'),
};
const table: PatternConfig = { type: 'data-list', entity: { [ROW_SET_MARKER]: true, ref: { entityType: 'Task', ids: ['t1'], total: 1, query: {} } } };
const effect = (repaint?: 'rows-changed'): ClientEffectByTrait => ({ traitName: 'Board', effect: ['render-ui', 'main', table], ...(repaint !== undefined ? { repaint } : {}) });

function setup() {
  const rowsChanged = vi.fn();
  const resolver: RowSetResolver = { resolve: () => ({ rows: [], total: 0, loading: false }), rowsChanged, subscribe: () => () => undefined, epoch: () => 0 };
  const wrapper = ({ children }: { children?: React.ReactNode }) => <RowSetResolverProvider resolver={resolver}>{children}</RowSetResolverProvider>;
  const { result } = renderHook(() => useSlotFlush(slots, undefined), { wrapper });
  return { rowsChanged, apply: result.current.applyClientEffects };
}

describe('applyClientEffects and rows-changed', () => {
  it('a flagged repaint re-resolves the entity type its content references', () => {
    const { rowsChanged, apply } = setup();
    apply([], [effect('rows-changed')]);
    expect(rowsChanged).toHaveBeenCalledWith('Task');
  });

  it('control: the same content painted without the flag re-resolves nothing', () => {
    const { rowsChanged, apply } = setup();
    apply([], [effect()]);
    expect(rowsChanged).not.toHaveBeenCalled();
  });
});
