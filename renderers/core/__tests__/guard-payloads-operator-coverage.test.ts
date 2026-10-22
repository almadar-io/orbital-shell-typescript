/**
 * Exhaustive guard-operator coverage sweep — the CI gate against the next
 * `object/has`-shaped gap (see `guard-payloads-object-ops.test.ts`): every
 * guard operator actually used in the std + io behavior registries must be
 * on `buildGuardPayloads`'s recognized list (`isRecognizedGuardOperator`),
 * either with real synthesis or as a documented tracked gap
 * (`ACKNOWLEDGED_UNSYNTHESIZED_GUARD_OPERATORS` in guard-payloads.ts +
 * docs/Almadar_Verification_Gaps.md). A brand-new operator appearing in
 * either registry that isn't on either list fails this test — that's the
 * point: the gap has to be named, not merely silently absorbed into
 * `{pass:{}, fail:{}}` again.
 *
 * Mirrors the registry-sweep pattern in
 * `packages/almadar-evaluator/__tests__/compile-parity.test.ts` (same
 * relative registry paths, same graceful skip for a standalone clone).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { isRecognizedGuardOperator } from '../src/state-machine/guard-payloads.js';
import { installedRegistries } from './installed-registries.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const registries = [...installedRegistries(['@almadar/std', '@almadar-io/behaviors']).values()];

function collectOrbFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.orb')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * Same traversal `buildGuardPayloads` itself performs: the top-level
 * operator of every `guard` field, recursing only into `and`/`or`/`not`
 * sub-guards (the only combinators it descends into) — a guard operator
 * buried inside an unrecognized combinator's own args (e.g. inside `if`'s
 * condition/branches) is that combinator's problem, not a separate
 * top-level miss, so this intentionally does NOT recurse into `if`/`let`.
 */
function collectGuardOps(guard: unknown, into: Set<string>): void {
  if (typeof guard !== 'object' || guard === null) return; // bare-binding string / literal — no operator
  if (!Array.isArray(guard) || guard.length === 0) return;
  const op = guard[0];
  if (typeof op !== 'string') return;
  into.add(op);
  if (op === 'and' || op === 'or') {
    for (const sub of guard.slice(1)) collectGuardOps(sub, into);
  } else if (op === 'not') {
    collectGuardOps(guard[1], into);
  }
}

function collectGuardFields(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectGuardFields(item, into);
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'guard') collectGuardOps(value, into);
      collectGuardFields(value, into);
    }
  }
}

describe('buildGuardPayloads — exhaustive guard-operator corpus coverage', () => {
  const ops = new Set<string>();
  for (const reg of registries) {
    for (const file of collectOrbFiles(reg)) {
      const orb: unknown = JSON.parse(readFileSync(file, 'utf-8'));
      collectGuardFields(orb, ops);
    }
  }

  it('found a meaningful guard-operator corpus', () => {
    if (registries.length === 0) return; // standalone clone: no sibling registries
    expect(ops.size).toBeGreaterThan(0);
  });

  it('every guard operator used in the std/io registries is recognized (synthesized or a tracked gap)', () => {
    if (registries.length === 0) return;
    const unrecognized = [...ops].filter((op) => !isRecognizedGuardOperator(op)).sort();
    expect(unrecognized).toEqual([]);
  });
});
