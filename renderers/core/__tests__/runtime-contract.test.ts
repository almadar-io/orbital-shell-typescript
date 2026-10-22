import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRuntimeContract } from '../scripts/runtime-contract-projection.js';
import { patternsRegistry } from '../src/patterns/index.js';
import type { PatternsRegistry } from '../src/patterns/index.js';
import { isContentBodyPatternType } from '../src/patterns/content-grade.js';
import { createPatternContract, getPatternRuntimeDefinition } from '../src/patterns/runtime-contract.js';

const full = patternsRegistry as PatternsRegistry;
const fullContract = createPatternContract(full.patterns);
const shipped = createPatternContract(Object.fromEntries(Object.keys(full.patterns).map((name) => [name, getPatternRuntimeDefinition(name)!])));
const names = Object.keys(full.patterns);

describe('runtime pattern contract', () => {
  it('the shipped slim json is the projection of the registry (regenerate with scripts/generate-runtime-contract.ts)', () => {
    const onDisk = JSON.parse(readFileSync(join(import.meta.dirname, '../src/patterns/patterns-runtime-contract.json'), 'utf8'));
    expect(onDisk).toEqual(projectRuntimeContract(full));
  });

  it('answers every query exactly as the full registry does, for every pattern', () => {
    expect(names.length).toBeGreaterThan(200);
    for (const name of names) {
      expect(shipped.isEntityAwarePattern(name), name).toBe(fullContract.isEntityAwarePattern(name));
      expect(shipped.isDrawablePattern(name), name).toBe(fullContract.isDrawablePattern(name));
      expect(shipped.isDrawHostPattern(name), name).toBe(fullContract.isDrawHostPattern(name));
      expect(shipped.isValueInputPattern(name), name).toBe(fullContract.isValueInputPattern(name));
      expect(shipped.getPatternFieldsContract(name), name).toBe(fullContract.getPatternFieldsContract(name));
      expect([...shipped.eventKeyPropsOf(name)], name).toEqual([...fullContract.eventKeyPropsOf(name)]);
      expect([...shipped.eventListPropsOf(name)], name).toEqual([...fullContract.eventListPropsOf(name)]);
    }
    expect([...shipped.getPatternMinUsableWidths()]).toEqual([...fullContract.getPatternMinUsableWidths()]);
  });

  it('classifies content bodies from the slim contract exactly as from the full registry', () => {
    for (const name of names) {
      const declared = Object.values(full.patterns[name]?.propsSchema ?? {}).some((def) => def.kind === 'entity');
      expect(isContentBodyPatternType(name), name).toBe(declared);
    }
    expect(names.some((name) => isContentBodyPatternType(name))).toBe(true);
    expect(isContentBodyPatternType('no-such-pattern')).toBe(false);
  });

  it('keeps the prop schema the renderer reads and drops design-time text', () => {
    const slim = getPatternRuntimeDefinition('detail-panel');
    expect(slim?.propsSchema?.['entity']).toBeDefined();
    expect(slim?.description).toBeUndefined();
    expect(Object.values(slim?.propsSchema ?? {}).every((def) => def.description === undefined && def.enumValues === undefined)).toBe(true);
    expect(JSON.stringify(getPatternRuntimeDefinition('detail-panel')).length).toBeLessThan(JSON.stringify(full.patterns['detail-panel']).length);
  });

  it('control: an unknown pattern is unknown to both', () => {
    expect(getPatternRuntimeDefinition('no-such-pattern')).toBeNull();
    expect(shipped.isEntityAwarePattern('no-such-pattern')).toBe(false);
    expect(shipped.eventKeyPropsOf('no-such-pattern').size).toBe(0);
  });
});
