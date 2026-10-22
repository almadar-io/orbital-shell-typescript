import { describe, expect, it } from 'vitest';
import { EventSchema } from '../src/types/state-machine.js';

describe('Event.listened', () => {
  it('accepts an event the trait declared in its listens block', () => {
    const parsed = EventSchema.parse({ key: 'REFETCH_PAGE', name: 'Refetch Page', listened: true });
    expect(parsed.listened).toBe(true);
  });

  it('leaves an undeclared event without the tag', () => {
    expect(EventSchema.parse({ key: 'INIT', name: 'Init' }).listened).toBeUndefined();
  });

  it('rejects a non-boolean tag', () => {
    expect(EventSchema.safeParse({ key: 'X', name: 'X', listened: 'yes' }).success).toBe(false);
  });
});
