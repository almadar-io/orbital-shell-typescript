/**
 * The sexpr -> RowPredicate compiler, driven by the shared `pushdown/query-cases.json`: every case compiles to the
 * recorded query. The differential test against the evaluator lives in @almadar/runtime (core cannot import it).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileRowPredicate, parseFetchOrder, type PredicateCompileContext, type RowBindingResult } from '../src/row-predicate.js';
import type { RowPredicate, RowQuery } from '../src/service-types.js';
import type { SExpr } from '../src/types/expression.js';

interface Case {
  name: string;
  bindings: { user?: Record<string, string> };
  sexpr: { filter?: SExpr; readPolicy?: SExpr };
  query: RowQuery;
}
const vector: { fields: Array<{ name: string; required?: boolean }>; cases: Case[] } = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'pushdown', 'query-cases.json'), 'utf8'));
const required = new Set(vector.fields.filter((f) => f.required).map((f) => f.name));

const ctxFor = (user: Record<string, string> | undefined, requiredFields: ReadonlySet<string> = required): PredicateCompileContext => ({
  requiredFields,
  resolve: (term): RowBindingResult => {
    const value: string | undefined = user?.[term.split('.')[1]];
    return value !== undefined
      ? { kind: 'value', value }
      : { kind: 'unspecialised', detail: `${term} resolves to nothing` };
  },
});

function compiled(c: Case, requiredFields: ReadonlySet<string>): { policy?: RowPredicate; filter?: RowPredicate } | string {
  const out: { policy?: RowPredicate; filter?: RowPredicate } = {};
  for (const [key, expr] of [['policy', c.sexpr.readPolicy], ['filter', c.sexpr.filter]] as const) {
    if (expr === undefined) continue;
    const r = compileRowPredicate(expr, ctxFor(c.bindings.user, requiredFields));
    if (r.kind !== 'predicate') return r.kind;
    out[key] = r.predicate;
  }
  return out;
}

const ORDERING = /(?:^|[^a-z])(?:<|<=|>|>=)(?:$|[^a-z])/;
const usesOrdering = (c: Case): boolean => ORDERING.test(JSON.stringify([c.sexpr.filter, c.sexpr.readPolicy]).replace(/"([<>]=?)"/g, ' $1 '));

describe('compileRowPredicate against the shared query cases (all fields required)', () => {
  const all = new Set(['id', 'title', 'status', 'priority', 'owner', 'tags', 'score']);
  it.each(vector.cases)('$name', (c) => {
    const result = compiled(c, all);
    if (c.query.policy?.kind === 'const' && c.query.policy.value === false) {
      expect(result).toBe('unspecialised');
      return;
    }
    expect(typeof result).toBe('object');
    if (typeof result === 'string') return;
    expect(result.policy).toEqual(c.query.policy);
    expect(result.filter).toEqual(c.query.filter);
  });
});

describe('ordering comparisons need a required field (D-A21)', () => {
  it.each(vector.cases.filter(usesOrdering))('$name: not compiled when the field is not declared required', (c) => {
    expect(compiled(c, new Set(['id']))).toBe('null-semantics');
  });
  it('compiles on a required field', () => {
    expect(compileRowPredicate(['>', '@entity.score', 3], { requiredFields: new Set(['score']) }).kind).toBe('predicate');
  });
  it('id is always required', () => {
    expect(compileRowPredicate(['>', '@entity.id', 'a'], {}).kind).toBe('predicate');
  });
  it('equality never needs it', () => {
    expect(compileRowPredicate(['!=', '@entity.score', 3], {}).kind).toBe('predicate');
  });
});

interface CompileCase {
  name: string;
  bindings: { user?: Record<string, string>; payload?: Record<string, string[]> };
  sexpr: { filter?: SExpr; readPolicy?: SExpr };
  expect: { compiled?: { policy?: RowPredicate; filter?: RowPredicate }; interpreted?: string };
}
const compileVector: { requiredFields: string[]; cases: CompileCase[] } = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'pushdown', 'compile-cases.json'), 'utf8'));

describe('compile decisions shared with the Rust compiler (compile-cases.json)', () => {
  it.each(compileVector.cases)('$name', (c) => {
    const requiredFields = new Set(compileVector.requiredFields);
    const resolve = (term: string): RowBindingResult => {
      const [root, key] = term.slice(1).split('.');
      const source = root === 'user' ? c.bindings.user : root === 'payload' ? c.bindings.payload : undefined;
      const value = source?.[key];
      if (Array.isArray(value)) return { kind: 'list', values: value };
      return typeof value === 'string' ? { kind: 'value', value } : { kind: 'unspecialised', detail: `${term} resolves to nothing` };
    };
    const out: { policy?: RowPredicate; filter?: RowPredicate } = {};
    let interpreted: string | undefined;
    for (const [slot, expr, role] of [['policy', c.sexpr.readPolicy, 'policy'], ['filter', c.sexpr.filter, 'filter']] as const) {
      if (expr === undefined || interpreted !== undefined) continue;
      const r = compileRowPredicate(expr, { requiredFields, resolve, role });
      if (r.kind === 'predicate') out[slot] = r.predicate;
      else interpreted = r.kind === 'null-semantics' ? 'null-semantics' : 'not-expressible';
    }
    if (c.expect.compiled) expect(out).toEqual(c.expect.compiled);
    else expect(interpreted).toBe(c.expect.interpreted);
  });
});

describe('compileRowPredicate edges', () => {
  it('a boolean literal is a const', () => {
    expect(compileRowPredicate(true, {})).toEqual({ kind: 'predicate', predicate: { kind: 'const', value: true } });
  });
  it('a comparison between two fields is not expressible', () => {
    expect(compileRowPredicate(['=', ['object/get', '@entity', 'a'], ['object/get', '@entity', 'b']], {}).kind).toBe('inexpressible');
  });
  it('a function call on a field is not expressible, and no conjunct is dropped', () => {
    const r = compileRowPredicate(['and', ['=', ['object/get', '@entity', 'a'], 1], ['>', ['str/len', ['object/get', '@entity', 'b']], 2]], { requiredFields: new Set(['a', 'b']) });
    expect(r.kind).toBe('inexpressible');
  });
  it('a binding is not expressible without a resolver', () => {
    expect(compileRowPredicate(['=', '@entity.a', '@payload.x'], {}).kind).toBe('inexpressible');
  });
  it('a binding is folded to its value', () => {
    const r = compileRowPredicate(['=', '@entity.status', '@user.role'], ctxFor({ role: 'admin' }));
    expect(r).toEqual({ kind: 'predicate', predicate: { kind: 'compare', field: 'status', op: '==', value: 'admin' } });
  });
});

describe('parseFetchOrder', () => {
  it('reads field and direction, ascending by default', () => {
    expect(parseFetchOrder('priority')).toEqual({ field: 'priority', direction: 'asc' });
    expect(parseFetchOrder('priority:desc')).toEqual({ field: 'priority', direction: 'desc' });
  });
  it('is absent for no order', () => {
    expect(parseFetchOrder(undefined)).toBeUndefined();
    expect(parseFetchOrder('')).toBeUndefined();
  });
});
