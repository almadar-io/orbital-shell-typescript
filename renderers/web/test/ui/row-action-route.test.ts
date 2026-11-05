/**
 * `navigatesTo` on a list action item: a literal route or an authored
 * `(fn row <string>)`. An unresolvable route throws `RowActionRouteError`
 * instead of leaving the click to do nothing.
 */
import { describe, it, expect } from 'vitest';
import type { SExpr } from '@almadar/core';
import { RowActionRouteError, rowActionRoute } from '../../src/lib/row-action-when';

const bindings = { user: null };
const row = { id: 'r-1', slug: 'alpha', count: 3 };

const catchRouteError = (route: SExpr): RowActionRouteError => {
  try {
    rowActionRoute(route, row, bindings);
  } catch (error) {
    if (error instanceof RowActionRouteError) return error;
    throw error;
  }
  throw new Error('rowActionRoute did not throw');
};

describe('rowActionRoute', () => {
  it('returns a string route as is', () => {
    expect(rowActionRoute('/orders', row, bindings)).toBe('/orders');
  });

  it('returns the string a lambda evaluates to, and follows the row (control)', () => {
    const route: SExpr = ['fn', 'row', ['str/concat', '/items/', ['object/get', '@row', 'slug']]];
    expect(rowActionRoute(route, row, bindings)).toBe('/items/alpha');
    expect(rowActionRoute(route, { ...row, slug: 'beta' }, bindings)).toBe('/items/beta');
  });

  it('throws RowActionRouteError carrying the route and a reason for a malformed route', () => {
    const route: SExpr = ['fn', 'row'];
    const error = catchRouteError(route);
    expect(error.route).toEqual(route);
    expect(error.reason).toBe('not a (fn row <route>) lambda');
    expect(error.name).toBe('RowActionRouteError');
  });

  it('throws when the lambda does not evaluate to a string, while a string result passes (control)', () => {
    const error = catchRouteError(['fn', 'row', ['object/get', '@row', 'count']]);
    expect(error.reason).toBe('the expression did not evaluate to a string');
    expect(rowActionRoute(['fn', 'row', ['object/get', '@row', 'slug']], row, bindings)).toBe('alpha');
  });

  it('throws when the body throws, while a sound body passes (control)', () => {
    const error = catchRouteError(['fn', 'row', ['no-such-operator/boom', '@row']]);
    expect(error).toBeInstanceOf(RowActionRouteError);
    expect(error.reason.length).toBeGreaterThan(0);
    expect(rowActionRoute(['fn', 'row', 'ok'], row, bindings)).toBe('ok');
  });
});
