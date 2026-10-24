/**
 * A declared external input (`listens { EVENT -> input { … } }`) lowers onto the
 * trait's own event definition as `input: true` — the TS twin of Rust
 * `EventDefinition.input`.
 */

import { describe, it, expect } from 'vitest';
import { EventSchema, type Event } from '../index';

describe('EventSchema.input', () => {
  it('keeps an input marker', () => {
    const input: Event = { key: 'DO_CREATE', name: 'Do create', input: true };
    const parsed = EventSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.input).toBe(true);
  });

  it('control: an event with no marker is not an input', () => {
    const parsed = EventSchema.safeParse({ key: 'SAVE', name: 'Save' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.input).toBeUndefined();
  });

  it('rejects a non-boolean marker', () => {
    expect(EventSchema.safeParse({ key: 'X', name: 'X', input: 'yes' }).success).toBe(false);
  });
});
