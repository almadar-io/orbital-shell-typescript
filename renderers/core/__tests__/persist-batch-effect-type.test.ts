/**
 * `["persist", "batch", ops]` is a real effect (the runtime executes it), so the typed
 * effect union must accept it: as a literal op list, or as an expression that builds the
 * ops (the mindful feed maps records to updates). Type-level: this file must typecheck.
 */
import { describe, it, expect } from 'vitest';
import type { TypedEffect } from '../src/types/effect.js';

describe('persist batch effect type', () => {
  it('accepts a literal list of operations', () => {
    const effect: TypedEffect = ['persist', 'batch', [['create', 'Note', { title: 'a' }], ['delete', 'Note', '@payload.id']]];
    expect(effect[1]).toBe('batch');
  });

  it('accepts an expression that builds the operations, with emit config', () => {
    const effect: TypedEffect = [
      'persist', 'batch',
      ['array/map', '@entity.toSave', ['fn', 'v', ['update', 'FeedItem', ['object/get', '@v', 'id'], { status: ['object/get', '@v', 'status'] }]]],
      { emit: { success: 'Saved', failure: 'SaveFailed' } },
    ];
    expect(effect[1]).toBe('batch');
  });

  it('control: an unknown persist action is still rejected', () => {
    // @ts-expect-error — 'archive' is not a persist action
    const effect: TypedEffect = ['persist', 'archive', 'Note'];
    expect(effect[1]).toBe('archive');
  });
});
