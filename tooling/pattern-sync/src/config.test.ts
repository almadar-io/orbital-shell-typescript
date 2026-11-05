import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, resolveRepoRoot } from './config.js';

describe('pattern-sync output root', () => {
  it('accepts its own checkout', () => {
    expect(resolveRepoRoot(REPO_ROOT)).toBe(REPO_ROOT);
  });

  it('refuses another checkout before writing generated files', () => {
    expect(() => resolveRepoRoot(dirname(REPO_ROOT))).toThrow('pattern-sync refused output root');
  });
});
