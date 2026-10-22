/**
 * The JS half of the shared mock-seed parity vector.
 *
 * Canonical source: orbital-core `tests/baked/mock-seed/*.json`, read by
 * BOTH this test and `orbital-core/tests/mock_seed_parity.rs`. The
 * `almadar-sync rust` bake mirrors them into `__tests__/baked/mock-seed/` (and
 * into the crate) so each repo stays hermetic — CI is a standalone checkout
 * with no monorepo sibling to climb to. One authored file, not a per-language
 * pair — the whole point is that both implementations produce the same bytes.
 * Regenerating it is a deliberate spec change on both paths.
 *
 * Only `strategy: 'index'` is pinned: it is a pure function of (field, index),
 * so it is the only strategy Rust can reproduce. The seeded LCG is stateful and
 * order-dependent, so a shared vector over it would encode one implementation's
 * traversal order as the spec.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { sampleRows, type SampleEntity } from '../src/mock/index.js';
import { resolvePersonaSpec, type UserContext } from '../src/types/user.js';
import type { EntityRow } from '../src/types/entity.js';

const FIXTURE_DIR = join(import.meta.dirname, 'baked', 'mock-seed');

interface Vector {
  entity: SampleEntity;
  count: number;
  rows: EntityRow[];
}

function load(name: string): Vector {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as Vector;
}

describe('mock-seed parity vector', () => {
  it.each([
    ['a persistent collection', 'sample-rows.index.json'],
    ['a runtime singleton', 'sample-rows.runtime.index.json'],
  ])('reproduces the committed rows for %s', (_label, file) => {
    const { entity, count, rows } = load(file);
    expect(sampleRows(entity, count, 'index')).toEqual(rows);
  });

  it('covers every branch that can diverge between the two paths', () => {
    const { entity, rows } = load('sample-rows.index.json');
    const names = entity.fields.map((f) => f.name);
    // Guards against a future edit quietly shrinking the vector's reach.
    for (const required of [
      'emptyDefault', 'realDefault', 'tierAtFirst', 'tierAtThird',
      'vocabWithEmpty', 'vocabNoDefault', 'enumTyped', 'zeroNumber',
      'falseBool', 'dateOnly', 'withTime', 'stampish', 'emptyArray',
      'scalarItems', 'objectItems', 'emptyObject', 'propObject',
      'relOne', 'relMany', 'intrinsicNoDefault', 'intrinsicWithDefault', 'traitField',
      'orbitalField', 'moneyField', 'fileField',
    ]) {
      expect(names).toContain(required);
    }
    // Omitted keys are part of the contract, not an accident.
    expect(rows[0]).not.toHaveProperty('intrinsicNoDefault');
    // A trait or orbital value held as data seeds unbound (`none`), on both paths.
    expect(rows[0]).toHaveProperty('traitField', null);
    expect(rows[0]).toHaveProperty('orbitalField', null);
    // `id` and the timestamps are the caller's to stamp, and the two paths use
    // different id schemes by design ("Member Id 1" vs "Member-1").
    expect(rows[0]).not.toHaveProperty('id');
  });
});

interface PersonaVector {
  roster: UserContext[];
  cases: Array<{ spec: string; resolvesToId?: string; error?: boolean }>;
}

describe('persona-resolution parity vector', () => {
  it('resolves every committed case identically to the Rust path', () => {
    const { roster, cases } = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'persona-resolution.json'), 'utf8'),
    ) as PersonaVector;
    for (const c of cases) {
      if (c.error === true) {
        expect(() => resolvePersonaSpec(c.spec, roster), c.spec).toThrow();
      } else {
        expect(resolvePersonaSpec(c.spec, roster).id, c.spec).toBe(c.resolvesToId);
      }
    }
  });
});
