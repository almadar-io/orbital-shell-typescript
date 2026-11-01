import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getVocabulary, installedLanguages, registerVocabulary, type I18nTables, type LanguageCode } from '../src/i18n/index.js';
import { readVocabularyPacks } from '../src/language-data.js';
import { installTestKernel } from './kernel-glue.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Registers the first-party language packs (this package's devDependencies) and
 *  returns every installed language's tables, English first. */
export async function installFirstPartyPacks(): Promise<Record<LanguageCode, I18nTables>> {
  await installTestKernel();
  for (const pack of readVocabularyPacks(here, path.join(here, '.no-user-store'))) registerVocabulary(pack.vocabulary);
  const langs = installedLanguages();
  for (const code of ['ar', 'sl']) {
    if (!langs.includes(code)) throw new Error(`first-party language pack "${code}" is not installed for @almadar/core's tests`);
  }
  return Object.fromEntries(langs.map((lang) => [lang, getVocabulary(lang)]));
}
