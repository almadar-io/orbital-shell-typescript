import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ROW_SET_MARKER, type RowQueryPage, type RowSetRef } from '@almadar/core';
import { UISlotComponent } from '../UISlotRenderer';
import { UISlotProvider, useUISlots } from '../../../../providers/UISlotContext';
import { RowSetResolverProvider } from '../../../../providers/RowSetResolverContext';
import { createRowSetResolver } from '../../../../lib/row-set-resolver';

const ref: RowSetRef = { entityType: 'Task', ids: ['t1'], total: 1, query: {} };
const settle = () => act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });

function Harness({ slot }: { slot: 'modal' | 'drawer' }) {
  const { render: renderSlot } = useUISlots();
  return (
    <>
      <button
        data-testid="open"
        onClick={() =>
          renderSlot({
            target: slot,
            pattern: 'test-pattern',
            props: { title: 'Tasks', items: { [ROW_SET_MARKER]: true, ref } },
          })
        }
      >
        Open
      </button>
      <UISlotComponent slot={slot} portal />
    </>
  );
}

const mount = (resolve: (r: RowSetRef) => Promise<RowQueryPage>, slot: 'modal' | 'drawer') =>
  render(
    <UISlotProvider>
      <RowSetResolverProvider resolver={createRowSetResolver({ resolve })}>
        <Harness slot={slot} />
      </RowSetResolverProvider>
    </UISlotProvider>,
  );

afterEach(() => vi.restoreAllMocks());

describe('G-CROSS-371: a failed row-set resolve in a portal slot', () => {
  for (const slot of ['modal', 'drawer'] as const) {
    it(`g_cross_371_failed_resolve_paints_an_error_in_the_${slot}`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mount(() => Promise.reject(new Error('offline')), slot);
      fireEvent.click(screen.getByTestId('open'));
      await settle();
      expect(screen.getByText(/row set of Task could not be resolved: offline/)).toBeTruthy();
    });
  }

  it('control: a resolving row set opens the modal as a dialog', async () => {
    mount(async () => ({ rows: [{ id: 't1' }], total: 1 }), 'modal');
    fireEvent.click(screen.getByTestId('open'));
    await settle();
    expect(screen.getByRole('dialog', { name: 'Tasks' })).toBeTruthy();
    expect(screen.queryByText(/could not be resolved/)).toBeNull();
  });
});
