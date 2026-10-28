/** `PayloadField` and `EventPayloadField` are one type and one schema (G-CORE-014). */
import { describe, it, expect } from 'vitest';
import { EventPayloadFieldSchema, PayloadFieldSchema, type EventPayloadField, type PayloadField } from '../src/types/index.js';

const field: PayloadField = {
  name: 'row',
  type: 'object',
  description: 'a row',
  entity: 'Note',
  projectedFrom: { type: 'Note', field: 'title' },
  items: { name: '', type: 'string' },
};

describe('one payload field type', () => {
  it('the event-contract name is the same schema and type', () => {
    const asEvent: EventPayloadField = field;
    expect(EventPayloadFieldSchema).toBe(PayloadFieldSchema);
    expect(EventPayloadFieldSchema.parse(asEvent)).toEqual(field);
  });

  it('control: a field without a name is refused at the top level', () => {
    expect(PayloadFieldSchema.safeParse({ name: '', type: 'string' }).success).toBe(false);
  });
});
