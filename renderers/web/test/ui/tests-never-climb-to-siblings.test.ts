/**
 * CI checks this package out alone, so a test that reads a sibling folder of the
 * monorepo either fails there or (behind an `existsSync` skip) never runs there.
 * 
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT, escapesPackage } from './helpers/package-root';

const tracked = execFileSync('git', ['ls-files'], { cwd: PACKAGE_ROOT, encoding: 'utf-8' })
  .split('\n')
  .filter((f) => /\.(ts|tsx)$/.test(f) && /(__tests__|\.test\.|^test\/)/.test(f))
  .filter((f) => existsSync(join(PACKAGE_ROOT, f)));

describe('ui tests stay inside the package', () => {
  it('no test builds a path into a sibling package', () => {
    const offenders = tracked
      .filter((f) => f !== 'test/ui/tests-never-climb-to-siblings.test.ts')
      .filter((f) => escapesPackage(join(PACKAGE_ROOT, f), readFileSync(join(PACKAGE_ROOT, f), 'utf-8'), PACKAGE_ROOT).length > 0);
    expect(offenders).toEqual([]);
  });

  it('control: a climb past the root is caught; a deep in-package path and a comment are not', () => {
    const file = join(PACKAGE_ROOT, 'src', 'preview', '__tests__', 'x.test.tsx');
    expect(escapesPackage(file, "join(REPO_ROOT, 'packages/almadar-std/behaviors')", PACKAGE_ROOT)).toHaveLength(1);
    expect(escapesPackage(file, "join(__dirname, '..', '..', '..', '..')", PACKAGE_ROOT)).toHaveLength(1);
    expect(escapesPackage(file, "join(__dirname, '..', '..')", PACKAGE_ROOT)).toEqual([]);
    expect(escapesPackage(file, "import { A } from '../../components/core/atoms';", PACKAGE_ROOT)).toEqual([]);
    expect(escapesPackage(file, "import { A } from '../../../../almadar-std';", PACKAGE_ROOT)).toHaveLength(1);
    expect(escapesPackage(file, '/** see `packages/almadar-std/x.orb` */\nconst a = 1;', PACKAGE_ROOT)).toEqual([]);
  });
});
