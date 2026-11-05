import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PATTERNS_DIR } from './config.js';
import source from './pattern-tile-geometry-source.json' with { type: 'json' };

const generated = JSON.parse(readFileSync(join(PATTERNS_DIR, 'pattern-tile-geometry.json'), 'utf8'));
const registry = JSON.parse(readFileSync(join(PATTERNS_DIR, 'patterns-registry.json'), 'utf8'));
const variants: Array<{
  height: number;
  elements: Array<{ kind: string; d?: string; cx?: number; cy?: number; r?: number }>;
}> = Object.values(source.variants);

describe('pattern tile geometry contract', () => {
  it('has the complete finite variant geometry', () => {
    expect(source.unit).toBe(100);
    expect(Object.keys(source.variants)).toHaveLength(14);
    expect(variants.flatMap((variant) => variant.elements)).toHaveLength(233);
    for (const variant of variants) {
      expect(variant.height).toBeGreaterThan(0);
      for (const element of variant.elements) {
        if (element.kind === 'path') expect(element.d).toBeTruthy();
        else if (element.kind === 'circle') {
          expect(typeof element.cx === 'number' && Number.isFinite(element.cx)).toBe(true);
          expect(typeof element.cy === 'number' && Number.isFinite(element.cy)).toBe(true);
          expect(element.r ?? 0).toBeGreaterThan(0);
        } else throw new Error(`unknown geometry kind ${element.kind}`);
      }
    }
  });

  it('generates one identical contract for web and native', () => {
    expect(generated).toEqual(source);
    expect(registry.patterns['pattern-tile'].geometry).toEqual(source);
  });
});
