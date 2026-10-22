import { describe, it, expect } from 'vitest';
import { normalizeEventKey, tickEventKey, UNMOUNT_EVENT } from '../src/types/bus.js';

describe('normalizeEventKey', () => {
  it('strips the UI: bus prefix', () => {
    expect(normalizeEventKey('UI:SAVE')).toBe('SAVE');
  });
  it('leaves an already-normalized key unchanged', () => {
    expect(normalizeEventKey('SAVE')).toBe('SAVE');
  });
  it('returns the empty string for an empty key', () => {
    expect(normalizeEventKey('')).toBe('');
  });
});

describe('tickEventKey', () => {
  it('prefixes the tick name', () => {
    expect(tickEventKey('beat')).toBe('$TICK_beat');
    expect(UNMOUNT_EVENT).toBe('$UNMOUNT');
  });
});
