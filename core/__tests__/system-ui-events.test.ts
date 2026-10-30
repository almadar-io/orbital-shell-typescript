import { describe, expect, it } from 'vitest';
import { SYSTEM_UI_EVENTS, isSystemUiEvent } from '../src/types/bus.js';

describe('isSystemUiEvent', () => {
  it('control: NAVIGATE is a nav-stack call now, not a bus event (G-ORB-523)', () => {
    expect(SYSTEM_UI_EVENTS).not.toContain('NAVIGATE');
    expect(isSystemUiEvent('NAVIGATE')).toBe(false);
  });

  it('names SIGN_OUT as host-level: the host ends the session (G-PATTERN-SYNC-031)', () => {
    expect(SYSTEM_UI_EVENTS).toContain('SIGN_OUT');
    expect(isSystemUiEvent('SIGN_OUT')).toBe(true);
  });

  it('control: trait events and near-misses are not host-level', () => {
    expect(isSystemUiEvent('CREATE')).toBe(false);
    expect(isSystemUiEvent('navigate')).toBe(false);
    expect(isSystemUiEvent('NAVIGATE_BACK')).toBe(false);
    expect(isSystemUiEvent('SIGNOUT')).toBe(false);
    expect(isSystemUiEvent('')).toBe(false);
  });
});
