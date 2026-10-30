/**
 * A payload field that is a list or a map of a union keeps its element as `items` (`[(Adv | string)]`,
 * `Map string (string | number)`): both payload schemas keep it, as Rust `PayloadField.items` (G-CROSS-270).
 */

import { describe, it, expect } from 'vitest';
import { EventPayloadFieldSchema, PayloadFieldSchema } from '../index';

const union = { name: 'item', type: 'union', properties: [{ name: 'Adv', type: 'object', properties: [{ name: 'id', type: 'number' }] }, { name: 'string', type: 'string' }] };

describe('payload field items', () => {
  it.each([['PayloadFieldSchema', PayloadFieldSchema], ['EventPayloadFieldSchema', EventPayloadFieldSchema]] as const)('%s keeps a list element union', (_, schema) => {
    const parsed = schema.safeParse({ name: 'via', type: 'array', items: union });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.items?.type).toBe('union');
  });

  it('a list element has no name (the kernel decodes it the same: orbital-core payload_check tests)', () => {
    expect(PayloadFieldSchema.safeParse({ name: 'via', type: 'array', items: { name: '', type: 'union' } }).success).toBe(true);
  });

  it('control: a payload field itself still needs a name', () => {
    expect(PayloadFieldSchema.safeParse({ name: '', type: 'array' }).success).toBe(false);
  });
});
