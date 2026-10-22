import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { QUOTE_HEAD, encodeQuoteBody, decodeQuoteBody, quoteExpr, quoteBodyOf } from '../src/types/expression';
import type { SExpr } from '../src/types/expression';

// G-CROSS-041: the `(quote x)` body codec. orbital-core's twin reads the same
// fixture (mirrored into baked/fixtures by pattern-sync `rust`), so both
// languages produce byte-identical bodies and decode each other's.
interface QuoteCase { name: string; expr: SExpr; body: string }
const CASES: QuoteCase[] = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'quote', 'cases.json'), 'utf8'));

describe('quote body codec', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s: encodes to the fixture body and decodes back', (_name, c) => {
    expect(encodeQuoteBody(c.expr)).toBe(c.body);
    expect(decodeQuoteBody(c.body)).toEqual(c.expr);
  });

  it('a body never carries a raw @, so no binding scanner can see inside it', () => {
    for (const c of CASES) expect(c.body.includes('@')).toBe(false);
  });

  it('quoteExpr builds the IR call and quoteBodyOf reads it back', () => {
    const q = quoteExpr(['>', '@payload.amount', 0]);
    expect(q[0]).toBe(QUOTE_HEAD);
    expect(quoteBodyOf(q)).toBe(encodeQuoteBody(['>', '@payload.amount', 0]));
  });

  it('control: quoteBodyOf rejects anything that is not a two-element quote call', () => {
    expect(quoteBodyOf(['quote'])).toBeUndefined();
    expect(quoteBodyOf(['quote', ['>', 1, 0]])).toBeUndefined();
    expect(quoteBodyOf(['not-quote', '"x"'])).toBeUndefined();
    expect(quoteBodyOf('quote')).toBeUndefined();
  });
});

describe('formatSExpr prints a quote readably', async () => {
  const { formatSExpr } = await import('../src/types/expression');
  it('shows the quoted expression, not its encoded body', () => {
    expect(formatSExpr(quoteExpr(['>', '@payload.amount', 0]))).toBe('(quote (> @payload.amount 0))');
  });
  it('control: an ordinary call is unchanged', () => {
    expect(formatSExpr(['>', '@payload.amount', 0])).toBe('(> @payload.amount 0)');
  });
});
