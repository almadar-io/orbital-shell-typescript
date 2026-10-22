import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { behaviorRegistryDir, discoverBehaviorPackages } from '../src/behavior-package.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The lowered `.orb` tree of each named behavior package installed for this
 *  package, keyed by package name; one not installed (a standalone clone) is absent. */
export function installedRegistries(names: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const pkg of discoverBehaviorPackages(here)) {
    if (names.includes(pkg.name)) out.set(pkg.name, behaviorRegistryDir(pkg));
  }
  return out;
}
