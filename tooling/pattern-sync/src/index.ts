import { scanAllComponents, getPublicComponentExports } from './scanner.js';
import { parseAllComponents } from './parser.js';
import { syncToRegistry, assertNoOrphanPatterns } from './writer.js';
import { generatePatternTypes } from './generate-pattern-types-sync.js';

const dryRun = process.argv.includes('--dry-run');
const verbose = process.argv.includes('--verbose');

const allFiles = scanAllComponents(undefined, true);
const publicExports = getPublicComponentExports();
const files = allFiles.filter((f) => !f.typesOnly && publicExports.has(f.fileName));
const components = parseAllComponents(files, verbose, allFiles, publicExports);
const report = syncToRegistry(components, dryRun, true);
console.log(`parsed ${components.length} components`, report);
if (!dryRun) {
  assertNoOrphanPatterns(publicExports);
}
const types = generatePatternTypes(dryRun);
console.log(`${types.patternCount} pattern types -> ${types.outputPath}`);
