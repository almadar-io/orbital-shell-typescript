import { describe, it, expect } from 'vitest';
import { EFFECT_OPERATORS, EFFECT_OPERATOR_FAMILIES, EntityPersistenceSchema } from '@almadar/core';
import { STD_OPERATORS } from '@almadar/std/registry';
import {
  AVL_3D_COLORS,
  persistencePaletteKey,
  exprOperatorPaletteKey,
  effectTypePaletteKey,
} from '../avl-3d-layout';

const ALL_KEYS = new Set<string>(Object.keys(AVL_3D_COLORS));

describe('persistencePaletteKey covers @almadar/core EntityPersistence', () => {
  it('maps every core persistence kind to its own key', () => {
    const keys = EntityPersistenceSchema.options.map(persistencePaletteKey);
    expect(new Set(keys).size).toBe(EntityPersistenceSchema.options.length);
    expect(keys).not.toContain('persistenceUnknown');
  });

  it('control: a value core does not declare is "unknown", never a guessed kind', () => {
    expect(persistencePaletteKey('singleton')).toBe('persistenceUnknown');
    expect(persistencePaletteKey('')).toBe('persistenceUnknown');
  });
});

describe('exprOperatorPaletteKey covers every @almadar/std operator', () => {
  it('gives each registered operator its category color key', () => {
    for (const [op, meta] of Object.entries(STD_OPERATORS)) {
      expect(exprOperatorPaletteKey(op), op).toBe(`op:${meta.category}`);
    }
  });

  it('control: a label that is not an operator is "unknown"', () => {
    expect(exprOperatorPaletteKey('@entity.qty')).toBe('exprOperatorUnknown');
    expect(exprOperatorPaletteKey('')).toBe('exprOperatorUnknown');
  });
});

describe('effectTypePaletteKey covers every @almadar/core effect', () => {
  it('classifies every literal effect operator and every effect family', () => {
    for (const op of EFFECT_OPERATORS) expect(effectTypePaletteKey(op), op).not.toBe('effectUnknown');
    for (const family of EFFECT_OPERATOR_FAMILIES) expect(effectTypePaletteKey(`${family}/anything`), family).not.toBe('effectUnknown');
  });

  it('control: an effect core does not declare is "unknown", never "control"', () => {
    expect(effectTypePaletteKey('made-up')).toBe('effectUnknown');
  });
});

describe('palette-key lookups stay in sync with AVL_3D_COLORS', () => {
  it('every key any lookup can return exists on AVL_3D_COLORS', () => {
    const returned = [
      ...EntityPersistenceSchema.options.map(persistencePaletteKey), persistencePaletteKey('x'),
      ...Object.keys(STD_OPERATORS).map(exprOperatorPaletteKey), exprOperatorPaletteKey('x'),
      ...EFFECT_OPERATORS.map(effectTypePaletteKey), effectTypePaletteKey('x'),
    ];
    for (const key of returned) expect(ALL_KEYS.has(key), key).toBe(true);
  });
});
