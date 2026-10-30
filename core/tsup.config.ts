import { defineConfig } from 'tsup';
import fs from 'node:fs';
import path from 'node:path';
import { BINDING_CONTEXT_RULES } from './src/types/bindings';
import { buildProgramTypes } from './src/program-types';
import { PROTOCOLS } from './src/protocols';
import { buildUiVocabulary, type ThemePresetKeys } from './src/ui-vocabulary';

export default defineConfig({
  entry: {
    'index': 'index.ts',
    'types/index': 'src/types/index.ts',
    'factory/index': 'src/factory/index.ts',
    'factory-runtime/index': 'src/factory-runtime/index.ts',
    'lolo-document/index': 'src/lolo-document/index.ts',
    'builders': 'src/builders.ts',
    'patterns/index': 'src/patterns/index.ts',
    'patterns/definitions': 'src/patterns/definitions.ts',
    'kernel-wire': 'src/generated/kernel-wire.ts',
    'i18n/index': 'src/i18n/index.ts',
    'themes/index': 'src/themes/index.ts',
    'fixtures': 'src/fixtures.ts',
    'behavior-package': 'src/behavior-package.ts',
    'language-data': 'src/language-data.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
  treeshake: true,
  outDir: 'dist',
  async onSuccess() {
    // Copy pattern JSON artifacts to dist/patterns/* so the merged registry
    // is available under @almadar/core/patterns/* (and can be re-exported by
    // the @almadar/patterns backward-compat shim).
    const patternsSrc = 'src/patterns';
    const patternsDist = 'dist/patterns';
    fs.mkdirSync(patternsDist, { recursive: true });
    const jsonFiles = [
      'component-mapping.json',
      'event-contracts.json',
      'patterns-registry.json',
      'services-registry.json',
      'ml-registry.json',
      'pattern-embeddings.json',
    ];
    for (const file of jsonFiles) {
      const src = path.join(patternsSrc, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(patternsDist, file));
      }
    }
    // Backwards-compatible alias used by some consumers.
    fs.copyFileSync(
      path.join(patternsSrc, 'patterns-registry.json'),
      path.join(patternsDist, 'registry.json'),
    );
    console.log('✓ Copied pattern JSON files to dist/patterns');
    fs.mkdirSync('dist/language', { recursive: true });
    fs.writeFileSync('dist/language/binding-rules.json', `${JSON.stringify(BINDING_CONTEXT_RULES, null, 2)}\n`);
    fs.writeFileSync('dist/language/program-types.json', `${JSON.stringify(buildProgramTypes(), null, 2)}\n`);
    fs.writeFileSync('dist/language/protocols.json', `${JSON.stringify(PROTOCOLS, null, 2)}\n`);
    const presets = fs
      .readdirSync('themes')
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(fs.readFileSync(path.join('themes', f), 'utf8')) as ThemePresetKeys);
    const uiVocabulary = buildUiVocabulary(presets, fs.readFileSync('src/lucide-icons.txt', 'utf8'));
    fs.writeFileSync('dist/language/ui-vocabulary.json', `${JSON.stringify(uiVocabulary, null, 2)}\n`);
    for (const file of ['vocabulary.json', 'constructs.json', 'validation-codes.json']) {
      fs.copyFileSync(path.join('src/generated/language', file), path.join('dist/language', file));
    }
  },
});
