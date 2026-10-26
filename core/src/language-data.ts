/**
 * The language-data bundle a host without `node_modules` (a browser running the
 * wasm `orb` clients) hands to `install_language` — TS mirror of
 * `orbital_core::language_data::install_language_bundle`. Read from the
 * INSTALLED `@almadar/core` and `@almadar/std` through their top-level
 * `orbLanguage` declarations, the same files `orb` reads natively
 * (`docs/Almadar_Behavior_Packages.md` §14), never a hardcoded layout.
 *
 * Node-only (reads with `node:fs`): exported from the
 * `@almadar/core/language-data` subpath only (the `fixtures` precedent).
 *
 * @packageDocumentation
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { installedPackageDirs, userStoreDir } from './behavior-package.js';
import { parseVocabularyPack, type LanguageCode, type VocabularyPack } from './i18n/index.js';
import type { ThemeDefinition } from './types/domain.js';
import type { JsonValue } from './types/json.js';

/** One installed language pack: the npm package declaring `orbVocabulary` and its vocabulary. */
export interface InstalledVocabularyPack {
  package: string;
  version: string;
  /** The `orb` versions the pack supports (`orbVocabulary.compiler`). */
  compiler: string;
  vocabulary: VocabularyPack;
}

export interface LanguageBundle {
  core: {
    version: string;
    compiler: string;
    patterns: JsonValue;
    componentMapping: JsonValue;
    eventContracts: JsonValue;
    services: JsonValue;
    bindingRules: JsonValue;
    programTypes: JsonValue;
    protocols: JsonValue;
    themes: ThemeDefinition[];
  };
  std: {
    version: string;
    compiler: string;
    operators: JsonValue;
  };
  /** Every installed language pack ({@link readVocabularyPacks}); English is built in. */
  vocabularies: InstalledVocabularyPack[];
}

interface LanguagePackage {
  root: string;
  version: string;
  block: Record<string, string>;
}

export class LanguageDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LanguageDataError';
  }
}

/** The nearest `node_modules/<name>/package.json` walking up from `fromDir` — the
 *  same walk as `orbital_core::behavior_packages::find_npm_package`. */
function findManifest(name: string, fromDir: string): string | null {
  let dir = resolve(fromDir);
  for (;;) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readLanguagePackage(name: string, fromDir: string): LanguagePackage {
  const manifestPath = findManifest(name, fromDir);
  if (!manifestPath) throw new LanguageDataError(`${name} is not installed (searched from ${fromDir})`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    version?: string;
    orbLanguage?: Record<string, string>;
  };
  if (!manifest.orbLanguage) throw new LanguageDataError(`${manifestPath} declares no \`orbLanguage\` block`);
  if (!manifest.orbLanguage.compiler) throw new LanguageDataError(`${manifestPath} declares no \`orbLanguage.compiler\` range`);
  return { root: dirname(manifestPath), version: manifest.version ?? '', block: manifest.orbLanguage };
}

function declared(pkg: LanguagePackage, field: string): string {
  const rel = pkg.block[field];
  if (!rel) throw new LanguageDataError(`${pkg.root}/package.json declares no \`orbLanguage.${field}\``);
  return join(pkg.root, rel);
}

function readJson(path: string): JsonValue {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
}

interface VocabularyManifest {
  name?: string;
  version?: string;
  orbVocabulary?: { compiler?: string; vocabulary?: string };
}

/**
 * Every installed language pack, the same rule as `orb` (`orbital-core`
 * `i18n::packs`): each package ({@link installedPackageDirs}, nearest first,
 * the user store last) whose `package.json` declares a top-level
 * `orbVocabulary`; nearest wins per package name. Two packages claiming one
 * language code, or a pack whose declared file is missing or malformed, fail
 * naming the package. Sorted by package name. Register them with
 * `registerVocabulary` from `@almadar/core/i18n` (each subpath is its own
 * bundle, so registration must go through the caller's i18n import).
 */
export function readVocabularyPacks(fromDir: string, userStore: string = userStoreDir()): InstalledVocabularyPack[] {
  const seen = new Set<string>();
  const packs: InstalledVocabularyPack[] = [];
  for (const dir of installedPackageDirs(fromDir, userStore)) {
    const manifestPath = join(dir, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VocabularyManifest;
    const block = manifest.orbVocabulary;
    if (!block || !manifest.name || seen.has(manifest.name)) continue;
    seen.add(manifest.name);
    if (!block.compiler || !block.vocabulary) {
      throw new LanguageDataError(`${manifest.name} (${manifestPath}): \`orbVocabulary\` needs \`compiler\` and \`vocabulary\``);
    }
    const file = join(dir, block.vocabulary);
    if (!existsSync(file)) throw new LanguageDataError(`${manifest.name}: declared vocabulary ${file} does not exist`);
    let vocabulary: VocabularyPack;
    try {
      vocabulary = parseVocabularyPack(JSON.parse(readFileSync(file, 'utf8')), `${manifest.name}/${block.vocabulary}`);
    } catch (e) {
      throw new LanguageDataError(`${manifest.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    packs.push({ package: manifest.name, version: manifest.version ?? '', compiler: block.compiler, vocabulary });
  }
  const byCode = new Map<LanguageCode, string>();
  for (const pack of packs) {
    const code = pack.vocabulary.meta.code;
    const other = byCode.get(code);
    if (other) throw new LanguageDataError(`language "${code}" is claimed by two packs: ${other} and ${pack.package}`);
    byCode.set(code, pack.package);
  }
  return packs.sort((a, b) => (a.package < b.package ? -1 : a.package > b.package ? 1 : 0));
}

/** Assemble the bundle from the `@almadar/core`, `@almadar/std` and language packs installed for `fromDir`. */
export function readLanguageBundle(fromDir: string, userStore: string = userStoreDir()): LanguageBundle {
  const core = readLanguagePackage('@almadar/core', fromDir);
  const std = readLanguagePackage('@almadar/std', fromDir);
  const themesDir = declared(core, 'themes');
  const themes = (existsSync(themesDir) ? readdirSync(themesDir) : [])
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(themesDir, f), 'utf8')) as ThemeDefinition);
  if (themes.length === 0) throw new LanguageDataError(`${themesDir} holds no theme presets`);
  return {
    core: {
      version: core.version,
      compiler: core.block.compiler,
      patterns: readJson(declared(core, 'patterns')),
      componentMapping: readJson(declared(core, 'componentMapping')),
      eventContracts: readJson(declared(core, 'eventContracts')),
      services: readJson(declared(core, 'services')),
      bindingRules: readJson(declared(core, 'bindingRules')),
      programTypes: readJson(declared(core, 'programTypes')),
      protocols: readJson(declared(core, 'protocols')),
      themes,
    },
    std: {
      version: std.version,
      compiler: std.block.compiler,
      operators: readJson(declared(std, 'operators')),
    },
    vocabularies: readVocabularyPacks(fromDir, userStore),
  };
}
