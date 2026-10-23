import { describe, expect, it } from 'vitest';
import { untouchedPersistence } from './helpers/persistence.js';
import { WriteDeclinedError, type PersistenceAdapter, type RowWriteBatch } from '@almadar/core';
import { writeRows } from '@almadar/shell-runtime/kernel/host';

const batch: RowWriteBatch = { ops: [{ kind: 'delete', entityType: 'Note', id: 'n1' }, { kind: 'delete', entityType: 'Note', id: 'n2' }], onFailure: 'atomic' };
const request = { kind: 'writeRows' as const, batch };

function declining(error: Error): PersistenceAdapter {
  return { ...untouchedPersistence(), writeBatch: async () => { throw error; } };
}

describe('kernel host writeRows', () => {
  it('maps a WriteDeclinedError to the wire writeUnsupported with its reason', async () => {
    expect(await writeRows(declining(new WriteDeclinedError('atomic-batch')), request)).toEqual({ kind: 'writeUnsupported', reason: 'atomic-batch' });
  });

  it('control: a plain Error stays a failed write', async () => {
    expect(await writeRows(declining(new Error('boom')), request)).toMatchObject({ kind: 'wrote', result: { error: expect.stringContaining('boom') } });
  });
});
