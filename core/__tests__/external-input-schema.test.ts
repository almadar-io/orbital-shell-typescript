/**
 * A declared external input (`listens { EVENT -> external { … } }`) lowers onto the
 * trait's own event definition as `external: true` — the TS twin of Rust
 * `EventDefinition.external`.
 */

import { describe, it, expect } from 'vitest';
import { EventSchema, type Event } from '../index';

describe('EventSchema.external', () => {
  it('keeps an external input marker', () => {
    const input: Event = { key: 'DO_CREATE', name: 'Do create', external: true };
    const parsed = EventSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.external).toBe(true);
  });

  it('control: an event with no marker is not an input', () => {
    const parsed = EventSchema.safeParse({ key: 'SAVE', name: 'Save' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.external).toBeUndefined();
  });

  it('rejects a non-boolean marker', () => {
    expect(EventSchema.safeParse({ key: 'X', name: 'X', external: 'yes' }).success).toBe(false);
  });
});
