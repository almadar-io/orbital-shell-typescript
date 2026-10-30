import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { discoverBehaviorPackages } from '../src/behavior-package.js';

// The discovery is `orb list --json --ancestors` (the std orb-packages atom): these run the real `orb` over temporary trees,
// each holding the installed std the bootloader finds its commands in (ALMADAR_STD_DIR and ALMADAR_CORE_DIR, else the nearest installed ones).
const ORB_BIN = process.env['ORB_BIN'] ?? join(process.env['HOME'] ?? '', 'bin', 'orb');

function installed(name: 'std' | 'core', named: string | undefined): string | undefined {
  if (named !== undefined) return named;
  for (let dir = import.meta.dirname; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', '@almadar', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) return undefined;
  }
}

const STD = installed('std', process.env['ALMADAR_STD_DIR']);
const CORE = installed('core', process.env['ALMADAR_CORE_DIR']);
const run = existsSync(ORB_BIN) && STD !== undefined && CORE !== undefined ? describe : describe.skip;

function writeManifest(dir: string, manifest: object): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
}

function behaviorPackage(nodeModules: string, name: string, prefix: string, version = '1.0.0'): void {
  writeManifest(join(nodeModules, name), { name, version, orb: { prefix, source: 'behaviors/lolo', compiler: '>=1.0.0' } });
  mkdirSync(join(nodeModules, name, 'behaviors/lolo'), { recursive: true });
}

/** A project whose tree has the installed std at its top, so `orb` finds its commands from any depth. */
function tree(): { work: string; project: string; home: string } {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'discover-')));
  const project = join(work, 'project');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(work, 'node_modules/@almadar'), { recursive: true });
  symlinkSync(STD ?? '', join(work, 'node_modules/@almadar/std'));
  symlinkSync(CORE ?? '', join(work, 'node_modules/@almadar/core'));
  return { work, project, home: join(work, 'home') };
}

const names = (found: ReturnType<typeof discoverBehaviorPackages>): string[] => found.map((p) => p.name).filter((n) => n !== '@almadar/std');

run('discoverBehaviorPackages — `orb list --json --ancestors`, the rule of `behavior_packages::discover`', () => {
  const opts = (home: string) => ({ orbBin: ORB_BIN, home });

  it('finds every installed behavior package, scoped or not — not a fixed list', () => {
    const { project, home } = tree();
    behaviorPackage(join(project, 'node_modules'), '@acme/hr-behaviors', 'acme-hr');
    behaviorPackage(join(project, 'node_modules'), 'community-games', 'community-games');
    expect(names(discoverBehaviorPackages(project, opts(home)))).toEqual(['@acme/hr-behaviors', 'community-games']);
  });

  it('nearest wins per name; the user store is the last rung', () => {
    const { work, project, home } = tree();
    const nested = join(project, 'app');
    mkdirSync(nested, { recursive: true });
    behaviorPackage(join(project, 'node_modules'), '@acme/hr-behaviors', 'acme-hr', '2.0.0');
    behaviorPackage(join(work, 'node_modules'), '@acme/hr-behaviors', 'acme-hr', '1.0.0');
    behaviorPackage(join(home, '.orb/node_modules'), '@acme/hr-behaviors', 'acme-hr', '0.1.0');
    behaviorPackage(join(home, '.orb/node_modules'), 'store-only', 'store-only');
    const found = discoverBehaviorPackages(nested, opts(home));
    expect(found.filter((p) => p.name !== '@almadar/std').map((p) => `${p.name}@${p.version}`)).toEqual(['@acme/hr-behaviors@2.0.0', 'store-only@1.0.0']);
  });

  it('a symlinked (workspace-linked) package is discovered at its real root, with its declared block and lock', () => {
    const { work, project, home } = tree();
    const real = join(work, 'packages/vendor');
    writeManifest(real, { name: '@vendor/behaviors', version: '1.0.0', orb: { prefix: 'vendor', source: 'behaviors/lolo', vectors: 'v.bin', compiler: '>=1.0.0' } });
    mkdirSync(join(real, 'behaviors/lolo'), { recursive: true });
    writeFileSync(join(real, 'v.bin'), '');
    const sha256 = 'a'.repeat(64);
    writeFileSync(join(real, 'sidecars.lock.json'), JSON.stringify({ version: 1, files: { 'v.bin': { sha256, bytes: 9, url: 'https://sidecars.test/v' } } }));
    mkdirSync(join(project, 'node_modules/@vendor'), { recursive: true });
    symlinkSync(real, join(project, 'node_modules/@vendor/behaviors'));
    const [pkg] = discoverBehaviorPackages(project, opts(home)).filter((p) => p.name === '@vendor/behaviors');
    expect(pkg?.root).toBe(real);
    expect(pkg?.orb).toEqual({ prefix: 'vendor', source: 'behaviors/lolo', vectors: 'v.bin', compiler: '>=1.0.0' });
    expect(pkg?.lock?.files['v.bin']).toEqual({ sha256, bytes: 9, url: 'https://sidecars.test/v' });
  });

  it('control: packages without a behavior `orb` block are not behavior packages', () => {
    const { project, home } = tree();
    writeManifest(join(project, 'node_modules/left-pad'), { name: 'left-pad', version: '1.0.0' });
    writeManifest(join(project, 'node_modules/@acme/lang'), { name: '@acme/lang', version: '1.0.0', orb: { vectors: 'v.bin' } });
    expect(names(discoverBehaviorPackages(project, opts(home)))).toEqual([]);
  });

  it('edge: two packages claiming one prefix is an error naming the prefix', () => {
    const { project, home } = tree();
    behaviorPackage(join(project, 'node_modules'), '@a/behaviors', 'shared');
    behaviorPackage(join(project, 'node_modules'), '@b/behaviors', 'shared');
    expect(() => discoverBehaviorPackages(project, opts(home))).toThrow(/shared/);
  });

  it('edge: a malformed behavior block fails loudly, never skipped', () => {
    const { project, home } = tree();
    writeManifest(join(project, 'node_modules/broken'), { name: 'broken', version: '1.0.0', orb: { registry: 'r' } });
    expect(() => discoverBehaviorPackages(project, opts(home))).toThrow(/broken/);
  });
});
