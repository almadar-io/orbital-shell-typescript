/**
 * `payload` on a row/record action: the declared extra data an action sends,
 * authored as `payload: (fn row { key: <expr> })`. Every action emits
 * `{ id, row }` plus whatever its payload declares; one resolver owns it.
 */
import { describe, it, expect } from 'vitest';
import type { EntityRow, SExpr } from '@almadar/core';
import { rowActionPayload, type RowConditionalAction } from '../../src/lib/row-action-when';

type Act = RowConditionalAction & { readonly event: string };
const act = (a: Act): Act => a;

const row = { id: 't-7', status: 'open', qty: 3 };
const viewer = { user: { id: 'u-1', role: 'cook', permissions: [] } };

describe('rowActionPayload', () => {
  it('without a declared payload the action sends { id, row }', () => {
    expect(rowActionPayload(act({ event: 'VIEW' }), row, viewer)).toEqual({ id: 't-7', row });
  });

  it('a declared payload adds keys computed from the row and constants', () => {
    const payload: SExpr = ['fn', 'row', { ticketId: ['object/get', '@row', 'id'], readyAt: 'now', qty: 1 }];
    expect(rowActionPayload(act({ event: 'MARK_READY', payload }), row, viewer)).toEqual({
      id: 't-7',
      row,
      ticketId: 't-7',
      readyAt: 'now',
      qty: 1,
    });
  });

  it('payload expressions can read the viewer', () => {
    const payload: SExpr = ['fn', 'row', { by: '@user.id' }];
    expect(rowActionPayload(act({ event: 'ASSIGN', payload }), row, viewer).by).toBe('u-1');
  });

  it('a compiled payload function is called with the row', () => {
    const payload = (r: EntityRow) => ({ entryId: r.id });
    expect(rowActionPayload(act({ event: 'PROMOTE', payload }), row, viewer)).toEqual({ id: 't-7', row, entryId: 't-7' });
  });

  it('control: a malformed payload falls back to { id, row } (never drops the row)', () => {
    const payload: SExpr = ['not-a-lambda'];
    expect(rowActionPayload(act({ event: 'X', payload }), row, viewer)).toEqual({ id: 't-7', row });
  });

  it('a declared key wins over the defaults (explicit beats implicit)', () => {
    const payload: SExpr = ['fn', 'row', { id: ['object/get', '@row', 'status'] }];
    expect(rowActionPayload(act({ event: 'X', payload }), row, viewer).id).toBe('open');
  });
});
