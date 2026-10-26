import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getVocabulary, installedLanguages, registerVocabulary } from '../src/i18n/index.js';
import { LanguageDataError, readLanguageBundle, readVocabularyPacks } from '../src/language-data.js';

function write(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

function vocabularyPack(root: string, name: string, code: string, opts: { file?: boolean; orbital?: string } = {}): void {
  const dir = join(root, 'node_modules', name);
  write(join(dir, 'package.json'), JSON.stringify({ name, version: '1.2.0', orbVocabulary: { compiler: '>=17.0.0', vocabulary: 'vocabulary.json' } }));
  if (opts.file !== false) {
    write(join(dir, 'vocabulary.json'), JSON.stringify({
      meta: { code, name: `Lang ${code}`, rtl: false },
      keywords: { orbital: opts.orbital ?? `${code}-orbital` },
      orb: { orbitals: `${code}-orbitals` },
      operators: {},
    }));
  }
}

function project(opts: { std?: boolean; coreBlock?: Record<string, string> | null; themes?: string[] } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'lang-bundle-'));
  const core = join(root, 'node_modules/@almadar/core');
  const block = opts.coreBlock === undefined
    ? { compiler: '>=17.0.0', patterns: 'p/patterns.json', componentMapping: 'p/cm.json', eventContracts: 'p/ec.json', services: 'p/s.json', bindingRules: 'p/br.json', programTypes: 'p/pt.json', protocols: 'p/protocols.json', themes: 'themes' }
    : opts.coreBlock;
  write(join(core, 'package.json'), JSON.stringify({ name: '@almadar/core', version: '10.1.0', ...(block ? { orbLanguage: block } : {}) }));
  write(join(core, 'p/patterns.json'), '{"patterns":{"button":{}}}');
  write(join(core, 'p/cm.json'), '{"mappings":{}}');
  write(join(core, 'p/ec.json'), '{"contracts":{}}');
  write(join(core, 'p/s.json'), '{"services":{}}');
  write(join(core, 'p/br.json'), '{"guard":{"allowed":["entity"]}}');
  write(join(core, 'p/protocols.json'), '[{"name":"route","address":null,"viewer":true,"grant":null,"side":"client"}]');
  write(join(core, 'p/pt.json'), '{"OrbitalValue":{"type":"object","properties":{"behavior":{"type":"string","required":true}}}}');
  for (const name of opts.themes ?? ['zeta', 'alpha']) write(join(core, `themes/${name}.json`), JSON.stringify({ name, tokens: {} }));
  if (opts.std !== false) {
    const std = join(root, 'node_modules/@almadar/std');
    write(join(std, 'package.json'), JSON.stringify({ name: '@almadar/std', version: '8.2.0', orbLanguage: { compiler: '>=17.0.0', operators: 'ops.json' } }));
    write(join(std, 'ops.json'), '{"categories":{},"operators":{}}');
  }
  return root;
}

describe('readLanguageBundle', () => {
  it('reads every file the installed core and std declare under orbLanguage', () => {
    const bundle = readLanguageBundle(project());
    expect(bundle.core.version).toBe('10.1.0');
    expect(bundle.core.compiler).toBe('>=17.0.0');
    expect(bundle.core.patterns).toEqual({ patterns: { button: {} } });
    expect(bundle.core.bindingRules).toEqual({ guard: { allowed: ['entity'] } });
    expect(bundle.core.programTypes).toEqual({ OrbitalValue: { type: 'object', properties: { behavior: { type: 'string', required: true } } } });
    expect(bundle.core.protocols).toEqual([{ name: 'route', address: null, viewer: true, grant: null, side: 'client' }]);
    expect(bundle.core.themes.map((t) => t.name)).toEqual(['alpha', 'zeta']);
    expect(bundle.std).toEqual({ version: '8.2.0', compiler: '>=17.0.0', operators: { categories: {}, operators: {} } });
  });

  it('a missing std fails naming the package', () => {
    expect(() => readLanguageBundle(project({ std: false }))).toThrow(/@almadar\/std is not installed/);
  });

  it('a core without an orbLanguage block fails loudly', () => {
    expect(() => readLanguageBundle(project({ coreBlock: null }))).toThrow(LanguageDataError);
  });

  it('a core that declares no binding rules fails naming the key', () => {
    const block = { compiler: '>=17.0.0', patterns: 'p/patterns.json', componentMapping: 'p/cm.json', eventContracts: 'p/ec.json', services: 'p/s.json', themes: 'themes' };
    expect(() => readLanguageBundle(project({ coreBlock: block }))).toThrow(/orbLanguage\.bindingRules/);
  });

  it('a core that declares no program types fails naming the key', () => {
    const block = { compiler: '>=17.0.0', patterns: 'p/patterns.json', componentMapping: 'p/cm.json', eventContracts: 'p/ec.json', services: 'p/s.json', bindingRules: 'p/br.json', themes: 'themes' };
    expect(() => readLanguageBundle(project({ coreBlock: block }))).toThrow(/orbLanguage\.programTypes/);
  });

  it('a core that declares no protocol table fails naming the key', () => {
    const block = { compiler: '>=17.0.0', patterns: 'p/patterns.json', componentMapping: 'p/cm.json', eventContracts: 'p/ec.json', services: 'p/s.json', bindingRules: 'p/br.json', programTypes: 'p/pt.json', themes: 'themes' };
    expect(() => readLanguageBundle(project({ coreBlock: block }))).toThrow(/orbLanguage\.protocols/);
  });

  it('edge: an empty theme directory is refused, not an empty bundle', () => {
    expect(() => readLanguageBundle(project({ themes: [] }))).toThrow(/no theme presets/);
  });
});

describe('language packs', () => {
  it('every installed package declaring orbVocabulary is a pack, nearest first', () => {
    const root = project();
    vocabularyPack(root, '@someone/lolo-qa', 'qa');
    vocabularyPack(root, 'lolo-qb', 'qb');
    const packs = readVocabularyPacks(root, join(root, 'store'));
    expect(packs.map((p) => [p.package, p.version, p.compiler, p.vocabulary.meta.code])).toEqual([
      ['@someone/lolo-qa', '1.2.0', '>=17.0.0', 'qa'],
      ['lolo-qb', '1.2.0', '>=17.0.0', 'qb'],
    ]);
    expect(readLanguageBundle(root, join(root, 'store')).vocabularies.map((p) => p.vocabulary.meta.code)).toEqual(['qa', 'qb']);
  });

  it('control: no packs installed is an English-only bundle, not an error', () => {
    const root = project();
    expect(readLanguageBundle(root, join(root, 'store')).vocabularies).toEqual([]);
  });

  it('a project copy of a pack shadows the same package in an outer node_modules', () => {
    const outer = project();
    vocabularyPack(outer, 'lolo-qc', 'qc', { orbital: 'outer-orbital' });
    const inner = join(outer, 'app');
    vocabularyPack(inner, 'lolo-qc', 'qc', { orbital: 'inner-orbital' });
    const packs = readVocabularyPacks(inner, join(inner, 'store'));
    expect(packs).toHaveLength(1);
    expect(packs[0].vocabulary.keywords.orbital).toBe('inner-orbital');
  });

  it('two packages claiming one language code are refused, naming both', () => {
    const root = project();
    vocabularyPack(root, 'lolo-qd-one', 'qd');
    vocabularyPack(root, 'lolo-qd-two', 'qd');
    expect(() => readVocabularyPacks(root, join(root, 'store'))).toThrow(/qd.*lolo-qd-one.*lolo-qd-two/);
  });

  it('edge: a pack whose declared file is missing fails naming the package', () => {
    const root = project();
    vocabularyPack(root, 'lolo-qe', 'qe', { file: false });
    expect(() => readVocabularyPacks(root, join(root, 'store'))).toThrow(/lolo-qe/);
  });

  it('a read pack registers as a language for this process', () => {
    const root = project();
    vocabularyPack(root, 'lolo-qf', 'qf');
    for (const pack of readVocabularyPacks(root, join(root, 'store'))) registerVocabulary(pack.vocabulary);
    expect(installedLanguages()).toContain('qf');
    expect(getVocabulary('qf').keywords.orbital).toBe('qf-orbital');
  });
});
