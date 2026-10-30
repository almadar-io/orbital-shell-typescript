/**
 * A tick's `interval` must accept every form the schedulers parse.
 *
 * The schema used to allow only `"frame"` or a number while both runtimes already
 * handled durations and cron, so the gate rejected an hourly tick before its
 * scheduler ever saw it — and the failure surfaced only as
 * `traits.N: Invalid input` on the whole orbital.
 */

import { describe, it, expect } from 'vitest';
import { TickIntervalSchema, TraitTickSchema, safeParseOrbitalSchema } from '../index';

describe('TickIntervalSchema', () => {
  it('accepts the frame sentinel and millisecond numbers', () => {
    expect(TickIntervalSchema.safeParse('frame').success).toBe(true);
    expect(TickIntervalSchema.safeParse(1000).success).toBe(true);
  });

  it('accepts every duration form the schedulers parse', () => {
    for (const v of ['500ms', '5s', '1m', '2h', '30d']) {
      expect(TickIntervalSchema.safeParse(v).success, v).toBe(true);
    }
  });

  it('accepts 5-field cron expressions', () => {
    for (const v of ['0 * * * *', '0 9 * * *', '*/15 0 1 * 1']) {
      expect(TickIntervalSchema.safeParse(v).success, v).toBe(true);
    }
  });

  it('still rejects nonsense rather than accepting any string', () => {
    for (const v of ['', 'soon', '5 seconds', '0 9 * *', -1, 0]) {
      expect(TickIntervalSchema.safeParse(v).success, String(v)).toBe(false);
    }
  });

  it('a cron tick parses as a whole TraitTick', () => {
    const tick = {
      name: 'executionScan',
      interval: '0 * * * *',
      effects: [['fetch', 'ErasureRequest', { emit: { success: 'Loaded', failure: 'Failed' } }]],
    };
    expect(TraitTickSchema.safeParse(tick).success).toBe(true);
  });
});

describe('osGrants and deployment on the schema', () => {
  const base = {
    name: 'p',
    version: '1.0.0',
    orbitals: [
      {
        name: 'A',
        entity: { name: 'E', fields: [{ name: 'id', type: 'string', required: true }] },
        traits: [],
        pages: [],
        osGrants: { exec: ['git'] },
      },
    ],
  };

  it('parses a schema carrying osGrants and deployment', () => {
    const r = safeParseOrbitalSchema({
      ...base,
      osGrants: {
        fs: [{ glob: '/data/**', modes: ['read', 'create'] }],
        net: [{ target: 'db.internal:5432', kinds: ['tcp', 'listen'] }],
        sys: ['power-state'],
        desktop: ['notify'],
        stdio: ['out'],
      },
      deployment: { server: ['A'] },
    });
    expect(r.success).toBe(true);
  });

  it('passes an unknown fs mode on: the kernel decoder refuses it (orbital-core os_grants tests)', () => {
    const r = safeParseOrbitalSchema({
      ...base,
      osGrants: { fs: [{ glob: '/data/**', modes: ['execute'] }] },
    });
    expect(r.success).toBe(true);
    expect(safeParseOrbitalSchema(base).success).toBe(true);
  });
});
