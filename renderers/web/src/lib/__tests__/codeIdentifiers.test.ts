/**
 * Go to definition reads the identifier at a position: a dotted path like
 * `AppShell.traits.AppLayout` is one identifier, from its first segment to its
 * last, wherever in it the position falls.
 */
import { describe, expect, it } from 'vitest';
import { identifierAt } from '../codeIdentifiers';

const code = '  uses AppShell from "std/behaviors/std-app-layout"\n  trait L = AppShell.traits.AppLayout {';

describe('identifierAt', () => {
  it('reads the word at the position, from inside it or at its end', () => {
    const at = code.indexOf('AppShell') + 3;
    expect(identifierAt(code, at)).toEqual({ text: 'AppShell', start: code.indexOf('AppShell'), end: code.indexOf('AppShell') + 8 });
    expect(identifierAt(code, code.indexOf('AppShell') + 8)?.text).toBe('AppShell');
  });

  it('a dotted reference is one identifier, whichever segment the position is in', () => {
    const ref = code.indexOf('AppShell.traits');
    expect(identifierAt(code, ref + 2)?.text).toBe('AppShell.traits.AppLayout');
    expect(identifierAt(code, ref + 'AppShell.traits.'.length + 3)?.text).toBe('AppShell.traits.AppLayout');
  });

  it('control: whitespace or punctuation is no identifier', () => {
    expect(identifierAt(code, 0)).toBeNull();
    expect(identifierAt(code, code.indexOf('{'))).toBeNull();
  });

  it('edge: a trailing or doubled dot is not part of the identifier', () => {
    expect(identifierAt('A.traits. x', 3)?.text).toBe('A.traits');
    expect(identifierAt('A..b', 0)?.text).toBe('A');
  });
});
