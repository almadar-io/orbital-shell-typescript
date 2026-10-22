/**
 * Re-emitting an orbital with the same params must not change it. A rebuild
 * re-applies the entity's display rename; renaming an id to the name it
 * already has is a no-op — the same ledger, no `{from: X, to: X}` row — so
 * rebuilds are byte-stable (found rebuilding app-1789833059828's orbital twice).
 */
import { describe, it, expect } from 'vitest';
import { ledgerRename, type IdentityLedger } from '../src/types/identity';

const ledger: IdentityLedger = {
  schemaVersion: 1,
  entries: {
    ent_1: { id: 'ent_1', kind: 'entity', owner: 'workspace', bakedName: 'Placeholder', curName: 'Sequence', renames: [{ from: 'Placeholder', to: 'Sequence', at: 't0' }] },
  },
};

describe('ledgerRename', () => {
  it('renaming to the current name is a no-op: the same ledger', () => {
    expect(ledgerRename(ledger, 'ent_1', 'Sequence', 't1')).toBe(ledger);
  });

  it('control: a real rename records the row and the new current name', () => {
    const next = ledgerRename(ledger, 'ent_1', 'Campaign', 't1');
    expect(next.entries.ent_1.curName).toBe('Campaign');
    expect(next.entries.ent_1.renames).toEqual([
      { from: 'Placeholder', to: 'Sequence', at: 't0' },
      { from: 'Sequence', to: 'Campaign', at: 't1' },
    ]);
  });

  it('edge: an unknown id leaves the ledger as is', () => {
    expect(ledgerRename(ledger, 'ent_missing', 'X', 't1')).toBe(ledger);
  });
});
