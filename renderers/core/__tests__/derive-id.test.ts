/**
 * Cross-path fixture (W2-J1): `deriveId` must be byte-identical to the Rust
 * `derive_id` in `orbital-core/src/identity.rs`.
 *
 * Canonical source: `orbital-core/tests/fixtures/derive_id.json`, read by
 * BOTH that crate's `derive_id_fixture.rs` and this test. Mirrored here into
 * `__tests__/baked/derive-id/` (same convention as `mock-parity-vector.test.ts`)
 * so this package's tests stay hermetic — CI is a standalone checkout with no
 * `orbital-rust` sibling to climb to. One authored fixture, not a per-language
 * pair; regenerating it is a deliberate spec change on both paths.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { deriveId } from '../src/types/index.js';

const FIXTURE_PATH = join(import.meta.dirname, 'baked', 'derive-id', 'derive_id.json');

interface FixtureCase {
  parent: string;
  discriminator: string;
  expected: string;
}

const fixture: FixtureCase[] = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

describe('deriveId — fixture parity with Rust derive_id', () => {
  it('is non-empty', () => {
    expect(fixture.length).toBeGreaterThan(0);
  });

  for (const { parent, discriminator, expected } of fixture) {
    it(`matches the Rust fixture for (${parent}, ${discriminator})`, () => {
      expect(deriveId(parent, discriminator)).toBe(expected);
    });
  }
});

describe('deriveId — Rust invariants', () => {
  const parent = 'trt_01HZX5AAAAAAAAAAAAAAAAAA';

  it('is deterministic on repeat', () => {
    const a = deriveId(parent, 'InlineButtonRender1');
    const b = deriveId(parent, 'InlineButtonRender1');
    expect(a).toBe(b);
  });

  it('starts with the parent prefix and has prefix+26 total length', () => {
    const id = deriveId(parent, 'InlineButtonRender1');
    expect(id.startsWith('trt_')).toBe(true);
    expect(id.length).toBe('trt_'.length + 26);
  });

  it('is discriminator-distinct', () => {
    const a = deriveId(parent, 'InlineButtonRender1');
    const c = deriveId(parent, 'InlineButtonRender2');
    expect(a).not.toBe(c);
  });

  it('is parent-distinct', () => {
    const a = deriveId(parent, 'InlineButtonRender1');
    const d = deriveId('trt_01HZX5BBBBBBBBBBBBBBBBBB', 'InlineButtonRender1');
    expect(a).not.toBe(d);
  });
});
