import { describe, it, expect } from 'vitest';
import { RelationConfigSchema } from '../src/types/field.js';
import { JsonValueSchema } from '../src/types/json.js';

// A parsed relation is JSON data: an optional key the source leaves out stays out, so a program
// carrying it passes the runtime's JSON gate (program/eval refuses non-JSON arguments).
describe('RelationConfigSchema — parse output is JSON', () => {
  it('omits optional keys the source leaves out', () => {
    const parsed = RelationConfigSchema.parse({ entity: 'Apiary', cardinality: 'one' });
    expect(parsed).toStrictEqual({ entity: 'Apiary', cardinality: 'one' });
    expect(JsonValueSchema.safeParse(parsed).success).toBe(true);
  });

  it('control: optional keys the source gives are kept', () => {
    const parsed = RelationConfigSchema.parse({ entity: 'Apiary', cardinality: 'many', field: 'hives', onDelete: 'cascade' });
    expect(parsed).toStrictEqual({ entity: 'Apiary', cardinality: 'many', field: 'hives', onDelete: 'cascade' });
  });

  it('edge: the legacy `type` still normalizes to cardinality', () => {
    const parsed = RelationConfigSchema.parse({ entity: 'Apiary', type: 'one' });
    expect(parsed).toStrictEqual({ entity: 'Apiary', cardinality: 'one' });
  });

  it('edge: entity alone carries no cardinality key', () => {
    expect(RelationConfigSchema.parse({ entity: 'Apiary' })).toStrictEqual({ entity: 'Apiary' });
  });
});
