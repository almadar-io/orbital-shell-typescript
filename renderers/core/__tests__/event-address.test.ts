import { describe, expect, it } from 'vitest';
import { joinEventAddress, splitEventAddress } from '../src/types/trait.js';

describe('event address (twin of orbital-core tests/event_address.rs)', () => {
  it('each form splits and joins back', () => {
    for (const raw of ['SAVE', 'Form.SAVE', '*.SAVE', 'Tasks.TaskPersistor.DO_CREATE']) {
      const { event, source } = splitEventAddress(raw);
      expect(joinEventAddress(event, source)).toBe(raw);
    }
  });

  it('the three-part form is orbital, trait, event', () => {
    expect(splitEventAddress('Tasks.TaskPersistor.DO_CREATE')).toEqual({
      event: 'DO_CREATE',
      source: { kind: 'orbital', orbital: 'Tasks', trait: 'TaskPersistor' },
    });
  });

  it('control: a bare event has no source', () => {
    expect(splitEventAddress('SAVE')).toEqual({ event: 'SAVE' });
  });
});
