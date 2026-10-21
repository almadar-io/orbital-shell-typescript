'use client';
/**
 * The row-scoped action filter every list component shares: binds the viewer
 * (`@user`) from the ambient `UserProvider` once and returns the function that
 * yields the actions drawn for a row (see `lib/row-action-when`).
 */
import { useCallback } from 'react';
import { useUser } from '../providers/UserContext';
import type { EntityRow, EventPayload } from '@almadar/core';
import { actionsShownForRow, rowActionPayload, type RowConditionalAction } from '../lib/row-action-when';
import { usePendingRows } from '../core';
import { useEventBus } from '../core';

export function useRowActions(): <A extends RowConditionalAction>(
  actions: readonly A[],
  row: EntityRow,
) => readonly A[] {
  const { user } = useUser();
  return useCallback(
    <A extends RowConditionalAction>(actions: readonly A[], row: EntityRow) =>
      actionsShownForRow(actions, row, { user }),
    [user],
  );
}

/**
 * The payload every row/record action emits: `{ id, row }` plus its declared
 * `payload` (see `rowActionPayload`), with the viewer bound as `@user`.
 */
export function useRowActionPayload(): <A extends RowConditionalAction>(action: A, row: EntityRow) => EventPayload {
  const { user } = useUser();
  return useCallback(
    <A extends RowConditionalAction>(action: A, row: EntityRow) => rowActionPayload(action, row, { user }),
    [user],
  );
}

/**
 * Fires a row action and tracks THAT row's busy state: the row is pending
 * until every dispatch the action started has settled (lib/pendingDispatch).
 * Rows are keyed by `rowKey` (the row's id, else its index).
 */
export function useRowActionFire<A extends RowConditionalAction & { event?: string }>(): {
  fire: (action: A, row: EntityRow, rowKey: string) => void;
  isRowPending: (rowKey: string) => boolean;
} {
  const eventBus = useEventBus();
  const payloadFor = useRowActionPayload();
  const { isRowPending, activateRow } = usePendingRows();
  const fire = useCallback((action: A, row: EntityRow, rowKey: string) => {
    if (!action.event) return;
    const event = action.event;
    activateRow(rowKey, (pendingKey) => eventBus.emit(`UI:${event}`, payloadFor(action, row), { pendingKey }));
  }, [eventBus, payloadFor, activateRow]);
  return { fire, isRowPending };
}

/** The key a row's pending state is tracked under. */
export function rowPendingKey(row: EntityRow, index: number): string {
  return row.id !== undefined && row.id !== null ? String(row.id) : `#${index}`;
}
