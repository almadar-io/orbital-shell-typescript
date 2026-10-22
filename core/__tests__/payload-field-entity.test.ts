import { describe, expect, it } from 'vitest';

import { PayloadFieldSchema } from '../src/types/state-machine.js';

/**
 * `PayloadField.entity` — the JS twin of Rust `PayloadField.entity`
 * (B1-V item C). Zod strips unknown keys on parse, so the marker must be
 * declared in the schema or a round-trip through `.orb` JSON silently
 * drops it even though the TS type carries it.
 */
describe('PayloadFieldSchema.entity', () => {
  it('round-trips a scalar entity-typed field', () => {
    const wire = {
      name: 'row',
      type: 'object',
      required: true,
      entity: 'Note',
      properties: [
        { name: 'id', type: 'string', required: true },
        { name: 'title', type: 'string', required: true },
      ],
    };
    const parsed = PayloadFieldSchema.parse(wire);
    expect(parsed.entity).toBe('Note');
    expect(parsed.properties?.[0]?.entity).toBeUndefined();
  });

  it('round-trips the array-of-entity form with the element entity name', () => {
    const wire = {
      name: 'rows',
      type: '[object]',
      required: true,
      entity: 'Note',
      properties: [{ name: 'id', type: 'string', required: true }],
    };
    const parsed = PayloadFieldSchema.parse(wire);
    expect(parsed.type).toBe('[object]');
    expect(parsed.entity).toBe('Note');
  });

  it('leaves entity absent for an anonymous struct field', () => {
    const wire = {
      name: 'payload',
      type: 'object',
      properties: [{ name: 'present', type: 'string' }],
    };
    const parsed = PayloadFieldSchema.parse(wire);
    expect(parsed.entity).toBeUndefined();
  });

  it('rejects an empty-string entity — the marker names a real declared entity or is absent', () => {
    expect(() => PayloadFieldSchema.parse({ name: 'row', type: 'object', entity: '' })).toThrow();
  });
});
