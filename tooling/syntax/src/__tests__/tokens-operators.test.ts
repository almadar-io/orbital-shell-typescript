import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import tokens from '../tokens.json';

describe('G-STD-279 tokens.json operators', () => {
  it('lists exactly the operators of the installed @almadar/std canonical table', () => {
    const path = createRequire(import.meta.url).resolve('@almadar/std/canonical-operators.json');
    const canonical: { operators: Record<string, { category: string }> } = JSON.parse(readFileSync(path, 'utf-8'));
    expect([...tokens.allOperatorNames].sort()).toEqual(Object.keys(canonical.operators).sort());
  });
});
