#!/usr/bin/env tsx
/**
 * Generate tokens.json from live registries.
 *
 * Reads @almadar/std (canonical operator registry) and @almadar/core/patterns
 * to build a static snapshot of all valid tokens for the Prism highlighter.
 *
 * Run: npx tsx scripts/generate-tokens.ts
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';
import { STD_OPERATORS } from '@almadar/std';
import { behaviorRegistryDir, discoverBehaviorPackages } from '@almadar/core/behavior-package';
import { readVocabularyPacks } from '@almadar/core/language-data';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read patterns registry (merged from almadar-patterns into almadar-core)
const patternsPath = createRequire(import.meta.url).resolve('@almadar/core/patterns/patterns-registry.json');
const patterns = JSON.parse(readFileSync(patternsPath, 'utf-8'));

// Collapse a few closely-related raw @almadar/std categories into one AVL
// color namespace. Any category NOT listed here keeps its own name as the
// namespace (fallback below) — never silently bucket an unrecognized
// category into an unrelated one (this previously dumped every operator
// from any category the map hadn't caught up with, e.g. std-agent/std-vec/std-geo/..., into 'control' alongside genuine
// control-flow keywords like `let`/`do`/`fn`).
const categoryToColorNamespace: Record<string, string> = {
  'std-math': 'arithmetic',
  'std-prob': 'arithmetic',
  'std-str': 'string',
  'std-format': 'string',
  'std-array': 'collection',
  'std-object': 'collection',
  'std-validate': 'comparison',
};

const operatorsByNamespace: Record<string, string[]> = {};
for (const [name, meta] of Object.entries(STD_OPERATORS)) {
  const category = meta.category;
  const namespace = categoryToColorNamespace[category] ?? category;
  if (!operatorsByNamespace[namespace]) operatorsByNamespace[namespace] = [];
  operatorsByNamespace[namespace].push(name);
}

// Sort each namespace's operators
for (const ns of Object.keys(operatorsByNamespace)) {
  operatorsByNamespace[ns].sort((a, b) => b.length - a.length); // longest first for regex matching
}

// All operator names (flat)
const allOperatorNames = Object.keys(STD_OPERATORS);

// Pattern names
const patternNames = Object.keys(patterns.patterns).sort((a, b) => b.length - a.length);

// Standard behavior names: the installed @almadar/std's programs, read through its
// manifest (`behaviorRegistryDir` — a live package's lowered mirror or a published
// one's registry). Per-topic tiers: <topic>/{atoms,molecules,organisms}/*.orb.
const stdPackage = discoverBehaviorPackages(resolve(__dirname, '..')).find((pkg) => pkg.name === '@almadar/std');
if (!stdPackage) throw new Error('@almadar/std is not installed for @almadar/syntax — it is a dependency');
const registryDir = behaviorRegistryDir(stdPackage);
const behaviorNames: string[] = [];
for (const topic of readdirSync(registryDir)) {
  const topicDir = resolve(registryDir, topic);
  if (!statSync(topicDir).isDirectory()) continue;
  for (const level of ['atoms', 'molecules', 'organisms']) {
    const dir = resolve(topicDir, level);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.orb')) behaviorNames.push(f.replace('.orb', ''));
    }
  }
}

// Structural keys (from @almadar/core schema structure)
const structuralKeys = [
  'name', 'description', 'version', 'orbitals', 'entity', 'traits', 'pages',
  'stateMachine', 'states', 'events', 'transitions', 'fields', 'emits', 'listens',
  'persistence', 'linkedEntity', 'category', 'collection', 'uses', 'expects', 'services',
  'config', 'theme', 'design', 'domainContext', 'designTokens', 'customPatterns',
];

// Valid field types
const fieldTypes = [
  'string', 'number', 'boolean', 'date', 'timestamp', 'datetime',
  'email', 'url', 'phone', 'uuid', 'image', 'bytes',
  'array', 'object', 'enum', 'relation',
];

// Valid persistence kinds
const persistenceKinds = ['persistent', 'runtime'];

// Valid effect types — derived from @almadar/std's own 'effect' category so
// this can't drift the way the old hand-copied list did (it had accreted
// non-effect control/logic keywords 'if'/'when'/'do'/'let', a no-longer-
// existent 'wait', and was missing real effects like 'fetch-stream').
const effectTypes = Object.entries(STD_OPERATORS)
  .filter(([, meta]) => meta.category === 'effect')
  .map(([name]) => name)
  .sort((a, b) => b.length - a.length);

// UI slot names
const uiSlots = [
  'main', 'sidebar', 'modal', 'drawer', 'overlay', 'center',
  'toast', 'hud-top', 'hud-bottom', 'floating', 'system', 'content', 'screen',
];

// .lolo declaration keywords (distinct from `structuralKeys` above, which are
// .orb JSON schema object keys — these are bare-word .lolo syntax keywords).
const loloKeywords = [
  'app', 'orbital', 'uses', 'from', 'expects', 'entity', 'type', 'derived', 'extends',
  'trait', 'initial', 'state', 'for', 'emits', 'listens', 'ticks', 'config',
  'page', 'with',
];

// .lolo primitive type keywords (distinct from `fieldTypes` above, which
// describes @almadar/core's EntityField.type enum — these are the literal
// type-name tokens .lolo's own grammar recognizes).
const loloPrimitiveTypes = ['string', 'number', 'boolean', 'date', 'timestamp', 'datetime', 'int', 'email', 'url', 'phone', 'uuid', 'image', 'bytes'];

// .lolo entity-persistence AND event-scope keywords in one class (distinct
// from `persistenceKinds` above, which covers entity persistence only —
// .lolo's own highlighter merges the entity-persistence tags with the
// emitsScope internal/external tags into a single token class).
const loloPersistenceAndScope = ['persistent', 'runtime', 'internal', 'external'];

// .lolo trait category tags (the `[category]` marker after a trait's entity name).
const loloTraitCategories = [
  'interaction', 'integration', 'lifecycle', 'temporal', 'validation', 'notification', 'agent',
  'game-core', 'game-character', 'game-ai', 'game-combat', 'game-items', 'game-cards', 'game-board', 'game-puzzle',
];

// The language packs installed for this package (its devDependencies), snapshotted
// so the browser build carries them — a runtime node_modules walk is Node-only.
const vocabularyPacks = readVocabularyPacks(resolve(__dirname, '..'), resolve(__dirname, '../.no-user-store')).map(
  (pack) => pack.vocabulary,
);

// Build the tokens file
const tokens = {
  generatedAt: new Date().toISOString(),
  operatorCount: allOperatorNames.length,
  patternCount: patternNames.length,
  behaviorCount: behaviorNames.length,
  operatorsByNamespace,
  allOperatorNames,
  patternNames,
  behaviorNames,
  structuralKeys,
  fieldTypes,
  persistenceKinds,
  effectTypes,
  uiSlots,
  loloKeywords,
  loloPrimitiveTypes,
  loloPersistenceAndScope,
  loloTraitCategories,
  vocabularyPacks,
};

// Write to src/ so it's committed and typecheck works without build
const outPath = resolve(__dirname, '../src/tokens.json');
writeFileSync(outPath, JSON.stringify(tokens, null, 2));

console.log(`Generated tokens.json:`);
console.log(`  Operators: ${allOperatorNames.length} (${Object.keys(operatorsByNamespace).length} namespaces)`);
console.log(`  Patterns: ${patternNames.length}`);
console.log(`  Behaviors: ${behaviorNames.length}`);
console.log(`  language packs: ${vocabularyPacks.map((v) => v.meta.code).join(', ') || '(none)'}`);
console.log(`  Written to: ${outPath}`);
