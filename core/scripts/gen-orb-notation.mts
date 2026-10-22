/**
 * Regenerates `src/i18n/orb-notation.json` — the `.orb` schema keys that are
 * DESIGN-SYSTEM notation rather than language vocabulary, and so must not be
 * translated.
 *
 * Owner ruling 2026-09-07: the i18n vocabulary is what the LANGUAGE defines;
 * a library's API surface stays English. The `orb` section is specced as
 * "every serialized key of the `.orb` schema", and a theme's token maps put
 * their token NAMES in key position — so the type-walk that builds the section
 * swept in the colour palette, the spacing and type scales, density, motion
 * and the rest. `sm`, `lg` and friends were named explicitly as notation.
 *
 * The split is derived, not curated: a key whose EVERY path through
 * `OrbitalSchema` lies under a theme `tokens` node is notation. A key that is
 * also reachable elsewhere is kept — the token GROUP names (`colors`,
 * `spacing`, `typography`, …) are theme structure the language defines, and
 * `style` / `transition` are structural keys in their own right.
 *
 * Run: pnpm --filter @almadar/core run gen:orb-notation
 */
import ts from 'typescript';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OPAQUE_TYPES =
  /PatternConfig|PatternProps|^Date$|^Promise$|^Function$|^Effect$|^TypedEffect$|^SExpression$|^SExpr$|^Expression$|^Guard$|^JsonValue$|^Json$/;
const OPAQUE_PROPS = new Set(['effects', 'guard', 'initialEffects', 'content', 'props']);
/** The design-token subtree: any node at or below a theme's `tokens`. */
const TOKEN_PATH = /\.tokens(\.|$)/;

/** Every path at which each property name is reachable from `OrbitalSchema`. */
export function collectPaths(entry: string): Map<string, Set<string>> {
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
  if (!sf) throw new Error(`gen-orb-notation: cannot load ${entry}`);

  let schemaType: ts.Type | undefined;
  ts.forEachChild(sf, (n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === 'OrbitalSchema') {
      schemaType = checker.getTypeAtLocation(n);
    }
  });
  if (!schemaType) throw new Error('gen-orb-notation: OrbitalSchema not found');

  const paths = new Map<string, Set<string>>();
  const seen = new Set<ts.Type>();
  const visit = (t: ts.Type | undefined, trail: string): void => {
    if (!t || seen.has(t)) return;
    seen.add(t);
    const name = t.aliasSymbol?.getName() ?? t.getSymbol()?.getName() ?? '';
    if (OPAQUE_TYPES.test(name)) return;
    if (t.isUnion() || t.isIntersection()) {
      for (const m of t.types) visit(m, trail);
      return;
    }
    if (checker.isArrayType(t) || checker.isTupleType(t)) {
      for (const a of checker.getTypeArguments(t as ts.TypeReference)) visit(a, trail);
      return;
    }
    if (!(t.flags & ts.TypeFlags.Object)) return;
    for (const info of checker.getIndexInfosOfType(t)) visit(info.type, trail);
    for (const prop of checker.getPropertiesOfType(t)) {
      const propName = prop.getName();
      if (propName.startsWith('__')) continue;
      let at = paths.get(propName);
      if (at === undefined) {
        at = new Set<string>();
        paths.set(propName, at);
      }
      at.add(trail);
      if (OPAQUE_PROPS.has(propName)) continue;
      const decl = prop.valueDeclaration ?? prop.declarations?.[0];
      const propType = decl
        ? checker.getTypeOfSymbolAtLocation(prop, decl)
        : checker.getTypeOfSymbol(prop);
      visit(propType, `${trail}.${propName}`);
    }
    const objectType = t as ts.ObjectType;
    for (const a of t.aliasTypeArguments ?? []) visit(a, trail);
    if (objectType.objectFlags & ts.ObjectFlags.Reference) {
      for (const a of checker.getTypeArguments(t as ts.TypeReference)) visit(a, trail);
    }
  };
  visit(schemaType, 'OrbitalSchema');
  return paths;
}

/** Keys reachable ONLY under a theme `tokens` node. */
export function notationKeys(paths: Map<string, Set<string>>): string[] {
  const out: string[] = [];
  for (const [key, where] of paths) {
    const all = [...where];
    const inTokens = all.filter((p) => TOKEN_PATH.test(p));
    if (inTokens.length > 0 && inTokens.length === all.length) out.push(key);
  }
  return out.sort();
}

/** Regenerate the committed file. Only when run directly — the universe test
 *  imports `collectPaths`/`notationKeys` to re-derive the set and must not
 *  rewrite the very file it is checking. */
export function main(): void {
  const here = import.meta.dirname;
  const entry = join(here, '..', 'src', 'types', 'schema.ts');
  const keys = notationKeys(collectPaths(entry));
  const dest = join(here, '..', 'src', 'i18n', 'orb-notation.json');
  writeFileSync(
    dest,
    JSON.stringify(
      {
        reason:
          'Design-system token NAMES reachable only under a theme `tokens` node. They are keys of the .orb schema but notation, not language vocabulary, so they are excluded from the `orb` i18n section (owner ruling 2026-09-07). Regenerate with: pnpm --filter @almadar/core run gen:orb-notation',
        keys,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`gen-orb-notation: wrote ${keys.length} keys to ${dest}`);
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main();
}
