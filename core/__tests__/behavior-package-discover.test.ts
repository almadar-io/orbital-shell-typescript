import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { discoverBehaviorPackages } from '../src/behavior-package.js';

const ORB = { index: 'i.json', embeddings: [], compiler: '>=1.0.0', source: 'behaviors/lolo' };

function writeManifest(dir: string, manifest: object): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
}

function behaviorPackage(nodeModules: string, name: string, prefix: string, version = '1.0.0'): void {
  writeManifest(join(nodeModules, name), { name, version, orb: { prefix, ...ORB } });
}

function tree(): { work: string; project: string; store: string } {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'discover-')));
  const project = join(work, 'project');
  mkdirSync(project, { recursive: true });
  return { work, project, store: join(work, 'store') };
}

describe('discoverBehaviorPackages — the Rust `behavior_packages::discover` rule', () => {
  it('finds every installed behavior package, scoped or not — not a fixed list', () => {
    const { project, store } = tree();
    behaviorPackage(join(project, 'node_modules'), '@almadar/std', 'std/behaviors');
    behaviorPackage(join(project, 'node_modules'), '@acme/hr-behaviors', 'acme-hr');
    behaviorPackage(join(project, 'node_modules'), 'community-games', 'community-games');
    expect(discoverBehaviorPackages(project, store).map((p) => p.name)).toEqual(['@acme/hr-behaviors', '@almadar/std', 'community-games']);
  });

  it('nearest wins per name; the user store is the last rung', () => {
    const { work, project, store } = tree();
    const nested = join(project, 'app');
    mkdirSync(nested, { recursive: true });
    behaviorPackage(join(project, 'node_modules'), '@acme/hr-behaviors', 'acme-hr', '2.0.0');
    behaviorPackage(join(work, 'node_modules'), '@acme/hr-behaviors', 'acme-hr', '1.0.0');
    behaviorPackage(join(store, 'node_modules'), '@acme/hr-behaviors', 'acme-hr', '0.1.0');
    behaviorPackage(join(store, 'node_modules'), 'store-only', 'store-only');
    const found = discoverBehaviorPackages(nested, store);
    expect(found.map((p) => `${p.name}@${p.version}`)).toEqual(['@acme/hr-behaviors@2.0.0', 'store-only@1.0.0']);
  });

  it('a symlinked (workspace-linked) package is discovered at its real root', () => {
    const { work, project, store } = tree();
    const real = join(work, 'packages/vendor');
    writeManifest(real, { name: '@vendor/behaviors', version: '1.0.0', orb: { prefix: 'vendor', ...ORB } });
    mkdirSync(join(project, 'node_modules/@vendor'), { recursive: true });
    symlinkSync(real, join(project, 'node_modules/@vendor/behaviors'));
    expect(discoverBehaviorPackages(project, store).map((p) => p.root)).toEqual([real]);
  });

  it('control: packages without a behavior `orb` block are not behavior packages', () => {
    const { project, store } = tree();
    writeManifest(join(project, 'node_modules/left-pad'), { name: 'left-pad', version: '1.0.0' });
    writeManifest(join(project, 'node_modules/@almadar/core'), { name: '@almadar/core', version: '1.0.0', orb: { language: {} } });
    expect(discoverBehaviorPackages(project, store)).toEqual([]);
  });

  it('edge: two packages claiming one prefix is an error naming both', () => {
    const { project, store } = tree();
    behaviorPackage(join(project, 'node_modules'), '@a/behaviors', 'shared');
    behaviorPackage(join(project, 'node_modules'), '@b/behaviors', 'shared');
    expect(() => discoverBehaviorPackages(project, store)).toThrow(/prefix `shared`.*@a\/behaviors.*@b\/behaviors/);
  });

  it('edge: a malformed behavior block fails loudly, never skipped', () => {
    const { project, store } = tree();
    writeManifest(join(project, 'node_modules/broken'), { name: 'broken', version: '1.0.0', orb: { registry: 'r' } });
    expect(() => discoverBehaviorPackages(project, store)).toThrow(/broken/);
  });
});
