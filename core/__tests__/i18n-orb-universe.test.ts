/**
 * Walks the `OrbitalSchema` type tree via the TypeScript compiler API and
 * asserts the `.orb` structural vocabulary (en.json `orb` section, B1) is
 * exactly the TS-declared universe plus the recorded compiled-path-only
 * divergences (orb-rust-only.json). Ported from the scratch walker script
 * (`ts-universe.final.mjs`) used to design en.json's `orb` section.
 */

import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { englishTables, ORB_NOTATION_KEYS } from '../src/i18n/index.js';
import { collectPaths, notationKeys } from '../scripts/gen-orb-notation.mjs';

const OPAQUE_TYPES = /PatternConfig|PatternProps|^Date$|^Promise$|^Function$|^Effect$|^TypedEffect$|^SExpression$|^SExpr$|^Expression$|^Guard$|^JsonValue$|^Json$/;
const OPAQUE_PROPS = new Set(['effects', 'guard', 'initialEffects', 'content', 'props']);

interface WalkResult {
  names: Map<string, string>;
}

function walkOrbitalSchema(entry: string): WalkResult {
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    resolveJsonModule: true,
  });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entry);
  if (!sf) {
    throw new Error(`i18n-orb-universe: could not load source file ${entry}`);
  }

  let schemaType: ts.Type | undefined;
  ts.forEachChild(sf, (n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === 'OrbitalSchema') {
      schemaType = checker.getTypeAtLocation(n);
    }
  });
  if (!schemaType) {
    throw new Error(`i18n-orb-universe: OrbitalSchema interface not found in ${entry}`);
  }

  const names = new Map<string, string>();
  const seen = new Set<ts.Type>();

  function visit(t: ts.Type | undefined, trail: string): void {
    if (!t || seen.has(t)) return;
    seen.add(t);
    const name = t.aliasSymbol?.getName() ?? t.getSymbol()?.getName() ?? '';
    if (OPAQUE_TYPES.test(name)) return;
    if (t.isUnion() || t.isIntersection()) {
      for (const member of t.types) visit(member, trail);
      return;
    }
    if (checker.isArrayType(t) || checker.isTupleType(t)) {
      for (const arg of checker.getTypeArguments(t as ts.TypeReference)) visit(arg, trail);
      return;
    }
    if (!(t.flags & ts.TypeFlags.Object)) return;
    for (const indexInfo of checker.getIndexInfosOfType(t)) visit(indexInfo.type, trail);
    for (const prop of checker.getPropertiesOfType(t)) {
      const propName = prop.getName();
      if (propName.startsWith('__')) continue;
      if (!names.has(propName)) names.set(propName, trail);
      if (OPAQUE_PROPS.has(propName)) continue;
      const decl = prop.valueDeclaration ?? prop.declarations?.[0];
      const propType = decl ? checker.getTypeOfSymbolAtLocation(prop, decl) : checker.getTypeOfSymbol(prop);
      visit(propType, `${trail}.${propName}`);
    }
    const objectType = t as ts.ObjectType;
    for (const arg of t.aliasTypeArguments ?? []) visit(arg, trail);
    if (objectType.objectFlags & ts.ObjectFlags.Reference) {
      for (const arg of checker.getTypeArguments(t as ts.TypeReference)) visit(arg, trail);
    }
  }

  visit(schemaType, 'OrbitalSchema');
  return { names };
}

describe('.orb structural vocabulary vs the TS type universe', () => {
  it('en.orb == TS-universe ∪ orb-rust-only.json', () => {
    const entry = join(import.meta.dirname, '..', 'src', 'types', 'schema.ts');
    const { names } = walkOrbitalSchema(entry);
    const tsUniverse = [...names.keys()].sort();

    const orbRustOnly = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'src', 'i18n', 'orb-rust-only.json'), 'utf8'),
    ) as { keys: string[] };

    const enOrbKeys = new Set(Object.keys(englishTables.orb));
    const rustOnlySet = new Set(orbRustOnly.keys);

    // TS-universe − notation ⊆ en.orb. A key reachable ONLY under a theme
    // `tokens` node is a design-system token name, not language vocabulary
    // (owner ruling 2026-09-07), so it is deliberately absent.
    const tsNotInEnOrb = tsUniverse.filter(
      (name) => !enOrbKeys.has(name) && !ORB_NOTATION_KEYS.has(name),
    );
    expect(tsNotInEnOrb, `TS-declared OrbitalSchema propert${tsNotInEnOrb.length === 1 ? 'y' : 'ies'} missing from en.json "orb" section: ${tsNotInEnOrb.map((n) => `${n} (${names.get(n)})`).join(', ')}`).toEqual([]);

    // …and no notation key may be IN the vocabulary.
    const notationInVocabulary = [...enOrbKeys].filter((k) => ORB_NOTATION_KEYS.has(k)).sort();
    expect(notationInVocabulary, `design-system token names must not be vocabulary: ${notationInVocabulary.join(', ')}`).toEqual([]);

    // en.orb ⊆ TS-universe ∪ orb-rust-only.json
    const tsUniverseSet = new Set(tsUniverse);
    const enOrbUnexplained = [...enOrbKeys].filter((key) => !tsUniverseSet.has(key) && !rustOnlySet.has(key)).sort();
    expect(enOrbUnexplained, `en.json "orb" keys not declared in the TS type tree and not recorded in orb-rust-only.json: ${enOrbUnexplained.join(', ')}`).toEqual([]);
  });
});

/**
 * `orb-notation.json` is generated (`gen:orb-notation`) but committed, so it
 * can go stale the moment the theme types change. Re-derive it here from the
 * same walk the generator uses and fail on any drift — otherwise a new token
 * silently becomes translatable vocabulary again, which is the exact defect
 * this file was written to close.
 */
describe('orb-notation.json vs the schema', () => {
  it('matches a fresh walk of OrbitalSchema', () => {
    const entry = join(import.meta.dirname, '..', 'src', 'types', 'schema.ts');
    const derived = notationKeys(collectPaths(entry));
    expect(derived).toEqual([...ORB_NOTATION_KEYS].sort());
  });
});
