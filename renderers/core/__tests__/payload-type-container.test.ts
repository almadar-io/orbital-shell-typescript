/**
 * `payloadTypeContainer` — the one reading of which container a payload
 * field's `type` string declares. `[X]` is an array whose element is `X`
 * (lowering flattens `[Entity]` to `[object]` + element `properties`, see
 * `PayloadField.properties`); `object` is a plain object; every other
 * spelling (scalars, entity names, `@entity`, type variables, unions) is
 * opaque to a container check.
 */
import { describe, it, expect } from 'vitest';
import { payloadTypeContainer } from '../src/types/state-machine.js';

describe('payloadTypeContainer', () => {
  it('reads maps without splitting nested value types', () => {
    expect(payloadTypeContainer('Map<string,Asset>')).toEqual({ kind: 'map', key: 'string', value: 'Asset' });
    expect(payloadTypeContainer('Map<string,Map<string,[Asset]>>')).toEqual({ kind: 'map', key: 'string', value: 'Map<string,[Asset]>' });
    expect(payloadTypeContainer('Map<string>')).toEqual({ kind: 'opaque' });
  });
  it('reads a bracketed type as an array of its element', () => {
    expect(payloadTypeContainer('[object]')).toEqual({ kind: 'array', element: 'object' });
    expect(payloadTypeContainer('[string]')).toEqual({ kind: 'array', element: 'string' });
    expect(payloadTypeContainer('[CartItem]')).toEqual({ kind: 'array', element: 'CartItem' });
  });

  it('keeps nested and generic element spellings whole', () => {
    expect(payloadTypeContainer('[[float]]')).toEqual({ kind: 'array', element: '[float]' });
    expect(payloadTypeContainer('[Map<string,number>]')).toEqual({ kind: 'array', element: 'Map<string,number>' });
    expect(payloadTypeContainer('[$trows]')).toEqual({ kind: 'array', element: '$trows' });
  });

  it('reads the bare array primitive as an array of unknown element', () => {
    expect(payloadTypeContainer('array')).toEqual({ kind: 'array', element: '' });
  });

  it('reads object as an object', () => {
    expect(payloadTypeContainer('object')).toEqual({ kind: 'object' });
  });

  it('leaves every other spelling opaque', () => {
    for (const t of ['string', 'number', 'datetime', 'money', '@entity', 'CartItem', '$t', 'union', 'scalar', '[]', '[', 'object[]']) {
      expect(payloadTypeContainer(t)).toEqual({ kind: 'opaque' });
    }
  });
});
