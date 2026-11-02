/**
 * Every kernel registration spreads `programStamp(schema)`, so the program-level fields the kernel reads must ride it:
 * without the app's `theme` and `themes` a browser kernel refuses every `theme/set` key as undeclared and resolves
 * `@currentTheme` to the kernel default.
 */
import { describe, it, expect } from 'vitest';
import { programStamp } from '../../src/hooks/circuit/useCircuitKernel';

describe('programStamp', () => {
  it('carries the app theme and themes with the type-contract stamp', () => {
    const stamp = programStamp({ typeContractVersion: 1, theme: 'notion-editorial-light', themes: ['ink-wash-dark', 'scandi-light'] });
    expect(stamp).toEqual({ typeContractVersion: 1, theme: 'notion-editorial-light', themes: ['ink-wash-dark', 'scandi-light'] });
  });

  it('control: a program that declares none of them gets none', () => {
    expect(programStamp({})).toEqual({});
  });

  it('control: an empty themes list is carried as declared', () => {
    expect(programStamp({ themes: [] })).toEqual({ themes: [] });
  });
});
