import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseOrbitalSchema, type OrbitalSchema } from '@almadar/core';

/** A program composed by `orb resolve` from test/fixtures/programs/<name>.lolo, decoded as the kernel emits it. */
export function composedProgram(name: string): OrbitalSchema {
  return parseOrbitalSchema(JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'programs', `${name}.orb.json`), 'utf8')));
}
