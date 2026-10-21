import { describe, it, expect } from 'vitest';
import { AVL_INK, avlTint } from '../avl-theme';
import { AVL_3D_COLORS } from '../avl-3d-layout';
import { DOMAIN_COLORS } from '../../components/avl/molecules/AvlBehaviorGlyph';
import { OPERATOR_CATEGORY_COLORS, STATE_COLORS, EFFECT_CATEGORY_COLORS, CONNECTION_COLORS, getStateRole, effectCategoryOf, effectZoneOf } from '../avl-theme';
import { EFFECT_OPERATORS, EFFECT_OPERATOR_FAMILIES, FieldTagSchema } from '@almadar/core';
import { getStdEffectOperators } from '@almadar/std/registry';
import { FIELD_TYPE_SHAPES, fieldTypeShape } from '../../components/avl/atoms/AvlFieldType';

const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

type PaletteValue = string | number | { readonly [key: string]: PaletteValue };

function strings(value: PaletteValue): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [];
  return Object.values(value).flatMap(strings);
}

describe('AVL palettes are theme tokens', () => {
  const palettes: Record<string, PaletteValue> = {
    OPERATOR_CATEGORY_COLORS,
    STATE_COLORS,
    EFFECT_CATEGORY_COLORS,
    CONNECTION_COLORS,
    AVL_INK,
    AVL_3D_COLORS,
    DOMAIN_COLORS,
  };
  for (const [name, palette] of Object.entries(palettes)) {
    it(`${name} holds no literal color`, () => {
      const values = strings(palette);
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(v, `${name}: ${v}`).not.toMatch(LITERAL);
    });
  }

  it('avlTint derives from a token via color-mix', () => {
    expect(avlTint('var(--color-success)', 12)).toBe('color-mix(in srgb, var(--color-success) 12%, transparent)');
  });
});

describe('getStateRole is structural (takes no name)', () => {
  it('initial and terminal come from the flags', () => {
    expect(getStateRole(true, false, 1, 4)).toBe('initial');
    expect(getStateRole(false, true, 1, 4)).toBe('terminal');
  });

  it('hub = the max transition count, at least 3', () => {
    expect(getStateRole(false, false, 4, 4)).toBe('hub');
    expect(getStateRole(false, false, 2, 2)).toBe('default');
  });
});

describe('AVL covers every case @almadar/core declares', () => {
  it('classifies every core effect operator and effect family', () => {
    for (const op of EFFECT_OPERATORS) expect(effectCategoryOf(op), op).not.toBeNull();
    for (const family of EFFECT_OPERATOR_FAMILIES) expect(effectCategoryOf(`${family}/x`), family).not.toBeNull();
  });

  it('gives every core effect a world zone (persist lands in the store, set on the entity)', () => {
    for (const op of EFFECT_OPERATORS) expect(effectZoneOf(op), op).not.toBeNull();
    for (const family of EFFECT_OPERATOR_FAMILIES) expect(effectZoneOf(`${family}/x`), family).not.toBeNull();
    expect(effectZoneOf('persist')).toBe('store');
    expect(effectZoneOf('set')).toBe('entity');
    expect(effectZoneOf('made-up')).toBeNull();
  });

  it('classifies every effect operator the std registry runs', () => {
    expect(getStdEffectOperators().filter((op) => effectCategoryOf(op) === null)).toEqual([]);
  });

  it('control: an undeclared effect has no category (drawn as unknown, never guessed)', () => {
    expect(effectCategoryOf('made-up')).toBeNull();
    expect(effectCategoryOf('nofamily/x')).toBeNull();
  });

  it('draws every core field type', () => {
    for (const t of FieldTagSchema.options) expect(FIELD_TYPE_SHAPES[t], t).toBeDefined();
  });

  it('draws a type variable as its own shape, not a tag\'s', () => {
    expect(fieldTypeShape('$t')).toBe('variable');
    expect(fieldTypeShape('enum')).toBe('ring');
  });
});
