import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { USE_CLIENT, ensureUseClient, startsWithUseClient } from '../scripts/lib/ensure-use-client.mjs';

function build(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'use-client-'));
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), source);
  }
  return dir;
}

describe('ensureUseClient', () => {
  it('puts the directive first in an entry rollup stripped it from', () => {
    const dir = build({ 'core.js': "export { Box } from './chunk.js';\n" });
    ensureUseClient(dir, ['core'], 'js');
    const out = readFileSync(join(dir, 'core.js'), 'utf8');
    expect(out).toBe(`${USE_CLIENT}\nexport { Box } from './chunk.js';\n`);
    expect(startsWithUseClient(out)).toBe(true);
  });

  it('leaves an entry that already starts with the directive unchanged', () => {
    const source = `${USE_CLIENT}\nexport const a = 1;\n`;
    const dir = build({ 'index.js': source });
    ensureUseClient(dir, ['index'], 'js');
    expect(readFileSync(join(dir, 'index.js'), 'utf8')).toBe(source);
  });

  it('does not treat a directive after other code as the first statement', () => {
    expect(startsWithUseClient(`import x from 'y';\n${USE_CLIENT}\n`)).toBe(false);
  });

  it('covers nested entries and the cjs extension, and touches only the named entries', () => {
    const dir = build({ 'ssr/index.cjs': 'module.exports = {};\n', 'other.js': 'export {};\n' });
    ensureUseClient(dir, ['ssr/index'], 'cjs');
    expect(readFileSync(join(dir, 'ssr/index.cjs'), 'utf8').startsWith(`${USE_CLIENT}\n`)).toBe(true);
    expect(readFileSync(join(dir, 'other.js'), 'utf8')).toBe('export {};\n');
  });

  it('throws for an entry that was not built', () => {
    expect(() => ensureUseClient(build({}), ['missing'], 'js')).toThrow();
  });
});
