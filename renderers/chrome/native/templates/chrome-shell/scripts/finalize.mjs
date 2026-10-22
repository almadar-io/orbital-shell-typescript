// The compiler writes the manifest and the asset list beside the bundled program; the extension needs them in dist/.
// The kernel the worker runs needs the language data the installed packages declare (the operator table), as `orb` reads it.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { readLanguageBundle } from '@almadar/core/language-data';
copyFileSync('src/generated/manifest.json', 'dist/manifest.json');
for (const { from, to } of JSON.parse(readFileSync('src/generated/assets.json', 'utf8'))) {
  copyFileSync(from, `dist/${to}`);
}
writeFileSync('dist/language.json', JSON.stringify(readLanguageBundle(process.cwd())));
