/**
 * Class guard (G-UI-014, and its twin in lib/fn-form-lambda.ts found by the
 * std-realtime-chat repro): a runtime CommonJS `require()` of a source module
 * resolves only inside the compiled bundle — any source-native loader (vitest,
 * a dev server consuming sources) throws and the render crashes to the error
 * boundary. Cycles are broken with a module-level `React.lazy` instead.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const DIRS = ['components', 'hooks', 'lib', 'providers', 'runtime', 'context', 'renderer'];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'node_modules' || name === '__tests__' || name === 'dist') continue;
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('ui sources never runtime-require a module', () => {
  it('has no require(...) call', () => {
    const offenders = DIRS.flatMap((d) => sources(join(ROOT, d)))
      .filter((file) => readFileSync(file, 'utf-8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .some((line) => /(^|[^.\w`])require\(\s*["']/.test(line)));
    expect(offenders).toEqual([]);
  });
});
