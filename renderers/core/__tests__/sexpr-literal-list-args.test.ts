/**
 * A call's arguments are data: an argument that is an array without an operator head is a
 * literal list (both evaluators read it so), e.g. an inlined config list of objects in
 * `["array/nth", [{…}, {…}], "@entity.i"]`. Only the expression itself must be a call or atom.
 */
import { describe, it, expect } from 'vitest';
import { SExprSchema } from '../src/types/expression.js';

describe('SExprSchema argument positions', () => {
  it('accepts a literal list of objects as a call argument', () => {
    const guard = ['=', ['object/get', ['array/nth', [{ key: 'welcome' }, { key: 'offer' }], '@entity.i'], 'key'], 'offer'];
    expect(SExprSchema.safeParse(guard).success).toBe(true);
  });

  it('accepts an empty list and a list of numbers as arguments', () => {
    expect(SExprSchema.safeParse(['array/len', []]).success).toBe(true);
    expect(SExprSchema.safeParse(['array/includes', [1, 2, 3], '@payload.n']).success).toBe(true);
  });

  it('control: an expression that is itself an operator-less array is still rejected', () => {
    expect(SExprSchema.safeParse([{ key: 'welcome' }]).success).toBe(false);
    expect(SExprSchema.safeParse([]).success).toBe(false);
  });
});
