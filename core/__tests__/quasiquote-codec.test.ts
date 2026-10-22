import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  QUASIQUOTE_HEAD,
  UNQUOTE_HEAD,
  quasiquoteExpr,
  quasiquoteOf,
  instantiateQuasiquote,
  formatSExpr,
  encodeQuoteBody,
} from '../src/types/expression';
import type { SExpr } from '../src/types/expression';

// `(quasiquote x)` — a quoted template whose `(unquote e)` holes are live
// expressions. orbital-core's twin reads the same fixture.
interface QuasiquoteCase { name: string; template: SExpr; ir: SExpr[]; values: SExpr[]; result: SExpr }
const CASES: QuasiquoteCase[] = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'quasiquote', 'cases.json'), 'utf8'),
);

describe('quasiquote codec', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s: encodes to the fixture IR and instantiates', (_n, c) => {
    expect(quasiquoteExpr(c.template)).toEqual(c.ir);
    const parts = quasiquoteOf(c.ir);
    expect(parts).toBeDefined();
    expect(instantiateQuasiquote(parts!.body, c.values)).toEqual(c.result);
  });

  it('the body never carries a raw @; the holes stay live bindings', () => {
    const ir = quasiquoteExpr(['set', '@entity.a', [UNQUOTE_HEAD, '@payload.v']]);
    expect(ir[0]).toBe(QUASIQUOTE_HEAD);
    expect(ir[1].includes('@')).toBe(false);
    expect(ir[2]).toBe('@payload.v');
  });

  it('a hole value that is structured data is spliced as data, not re-encoded', () => {
    const ir = quasiquoteExpr({ widget: [UNQUOTE_HEAD, '@entity.w'] });
    const value: SExpr = { ref: 'std/std-kanban.traits.KanbanBoard', config: { compact: true } };
    expect(instantiateQuasiquote(quasiquoteOf(ir)!.body, [value])).toEqual({ widget: value });
  });

  it('the same expression unquoted twice is two holes', () => {
    const ir = quasiquoteExpr(['pair', [UNQUOTE_HEAD, '@entity.x'], [UNQUOTE_HEAD, '@entity.x']]);
    expect(ir.slice(2)).toEqual(['@entity.x', '@entity.x']);
  });

  it('control: a template with no hole has no hole slots', () => {
    const ir = quasiquoteExpr(['>', '@payload.amount', 0]);
    expect(ir).toEqual([QUASIQUOTE_HEAD, encodeQuoteBody(['>', '@payload.amount', 0])]);
  });

  it('rejects a nested quasiquote and an unquote inside a hole', () => {
    expect(() => quasiquoteExpr([QUASIQUOTE_HEAD, ['a']])).toThrow(/nested quasiquote/);
    expect(() => quasiquoteExpr([UNQUOTE_HEAD, [UNQUOTE_HEAD, 'x']])).toThrow(/unquote inside an unquote/);
  });

  it('rejects an unquote with no or extra arguments', () => {
    expect(() => quasiquoteExpr([UNQUOTE_HEAD])).toThrow(/exactly one/);
    expect(() => quasiquoteExpr([UNQUOTE_HEAD, 'a', 'b'])).toThrow(/exactly one/);
  });

  it('instantiate rejects a value count that does not match the holes', () => {
    const body = quasiquoteOf(quasiquoteExpr([UNQUOTE_HEAD, 'x']))!.body;
    expect(() => instantiateQuasiquote(body, [])).toThrow(/1 hole/);
    expect(() => instantiateQuasiquote(body, [1, 2])).toThrow(/1 hole/);
  });

  it('control: quasiquoteOf rejects quote calls and malformed arrays', () => {
    expect(quasiquoteOf(['quote', '"x"'])).toBeUndefined();
    expect(quasiquoteOf([QUASIQUOTE_HEAD])).toBeUndefined();
    expect(quasiquoteOf([QUASIQUOTE_HEAD, ['not-a-body']])).toBeUndefined();
  });

  it('formatSExpr prints the template with its holes', () => {
    expect(formatSExpr(quasiquoteExpr(['set', '@entity.a', [UNQUOTE_HEAD, '@payload.v']])))
      .toBe('(quasiquote (set @entity.a (unquote @payload.v)))');
  });
});

describe('toProgramData', async () => {
  const { toProgramData } = await import('../src/types/expression');
  it('passes JSON data through', () => {
    expect(toProgramData({ a: [1, 'x', null, true] })).toEqual({ a: [1, 'x', null, true] });
  });
  it('refuses a function and a Date', () => {
    expect(() => toProgramData(() => 1)).toThrow(/program data/);
    expect(() => toProgramData(new Date(0))).toThrow(/program data/);
  });
});
