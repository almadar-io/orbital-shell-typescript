import { describe, expect, it } from 'vitest';
import { parseOrbitalSchema, toPayloadValue } from '../src/types/index.js';

describe('G-CROSS-131 typed prop bridge (core)', () => {
  it('parseOrbitalSchema returns the validated OrbitalSchema without a cast', () => {
    const schema = parseOrbitalSchema({
      name: 'Demo',
      orbitals: [{ name: 'Notes', entity: { name: 'Note', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] }, traits: [], pages: [] }],
    });
    expect(schema.name).toBe('Demo');
    expect(schema.orbitals.map((o) => o.name)).toEqual(['Notes']);
  });

  it('control: parseOrbitalSchema rejects a value that is not a program', () => {
    expect(() => parseOrbitalSchema({ orbitals: 'nope' })).toThrow();
  });

  it('toPayloadValue gives a rich value its JSON wire form', () => {
    const when = new Date('2026-10-09T00:00:00.000Z');
    expect(toPayloadValue({ name: 'Demo', at: when, nested: { list: [1, 'a', true] }, gone: undefined }))
      .toEqual({ name: 'Demo', at: '2026-10-09T00:00:00.000Z', nested: { list: [1, 'a', true] } });
  });

  it('toPayloadValue keeps null and undefined as the absent value', () => {
    expect(toPayloadValue(null)).toBeNull();
    expect(toPayloadValue(undefined)).toBeUndefined();
  });
});
