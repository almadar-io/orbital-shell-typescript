import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BehaviorPackageError,
  readBehaviorPackage,
  behaviorRegistryDir,
  behaviorProgramFiles,
  behaviorSourceTree,
  resolveDeclaredFile,
  type BehaviorPackageOrbBlock,
} from '../src/behavior-package.js';

const CURRENT_ORB = {
  prefix: 'almadar-test',
  registry: 'behaviors/registry',
  compiler: '>=4.10.0',
};

const ORB = { ...CURRENT_ORB, embeddings: ['dist/behaviors-embeddings.json'] };
const VECTOR_ORB = { ...CURRENT_ORB, vectors: 'dist/vectors.vec' };

function fakePackage(orb: BehaviorPackageOrbBlock | undefined, files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'behavior-package-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@test/pkg', version: '1.0.0', orb }));
  for (const rel of files) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), '{}');
  }
  return root;
}

describe('orb block without signatures', () => {
  it('reads a package that declares no signatures file', () => {
    const pkg = readBehaviorPackage(fakePackage(ORB, []));
    expect(pkg.orb.prefix).toBe('almadar-test');
  });

  it('control: a package published with the retired factorySignatures key still reads, the key ignored', () => {
    const legacy = { ...ORB, factorySignatures: 'dist/registry/factory-signatures.json' };
    const pkg = readBehaviorPackage(fakePackage(legacy, []));
    expect(pkg.orb.prefix).toBe('almadar-test');
    expect('factorySignatures' in pkg.orb).toBe(false);
  });

  it('control: a package published with the retired loloContracts key still reads, the key ignored', () => {
    const legacy = { ...ORB, loloContracts: 'behaviors/lolo-behavior-contracts.json' };
    const pkg = readBehaviorPackage(fakePackage(legacy, []));
    expect(pkg.orb.prefix).toBe('almadar-test');
    expect('loloContracts' in pkg.orb).toBe(false);
  });

  it('control: a package published with the retired index key still reads, the key ignored', () => {
    const legacy = { ...ORB, index: 'dist/behaviors-registry.json' };
    const pkg = readBehaviorPackage(fakePackage(legacy, []));
    expect(pkg.orb.prefix).toBe('almadar-test');
    expect('index' in pkg.orb).toBe(false);
  });

  it('a package that declares no index reads', () => {
    expect(readBehaviorPackage(fakePackage(ORB, [])).orb.prefix).toBe('almadar-test');
  });
});

describe('readBehaviorPackage', () => {
  it('reads the declared orb block of a package root', () => {
    const root = fakePackage(ORB, []);
    const pkg = readBehaviorPackage(root);
    expect(pkg.name).toBe('@test/pkg');
    expect(pkg.orb.registry).toBe('behaviors/registry');
  });

  it('refuses a malformed orb block (missing a declared key)', () => {
    const root = mkdtempSync(join(tmpdir(), 'behavior-package-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@test/pkg', orb: { prefix: 'x' } }));
    expect(() => readBehaviorPackage(root)).toThrow(/malformed/);
  });

  it('refuses a package.json without an orb block', () => {
    const root = fakePackage(undefined, []);
    expect(() => readBehaviorPackage(root)).toThrow(BehaviorPackageError);
  });
});

describe('orb vector manifest', () => {
  it('reads the declared vectors path without retired embeddings', () => {
    const pkg = readBehaviorPackage(fakePackage(VECTOR_ORB, []));
    expect(pkg.orb.vectors).toBe('dist/vectors.vec');
    expect('embeddings' in pkg.orb).toBe(false);
  });

  it('control: a package declaring neither vectors nor embeddings reads without a snapshot', () => {
    const pkg = readBehaviorPackage(fakePackage(CURRENT_ORB, []));
    expect(pkg.orb.vectors).toBeUndefined();
    expect('embeddings' in pkg.orb).toBe(false);
  });

  it('ignores a retired embeddings declaration, including obsolete malformed entries', () => {
    const legacy = { ...CURRENT_ORB, embeddings: ['dist/gone.json', 3] };
    const pkg = readBehaviorPackage(fakePackage(legacy, []));
    expect(pkg.orb.vectors).toBeUndefined();
    expect('embeddings' in pkg.orb).toBe(false);
  });

  it.each([null, '', 7, ['dist/vectors.vec'], {}])('refuses a malformed vectors declaration: %j', (vectors) => {
    const root = fakePackage(ORB, []);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@test/pkg', orb: { ...ORB, vectors } }));
    expect(() => readBehaviorPackage(root)).toThrow(/vectors/);
  });

  it('keeps a source-only package live with a vector-only declaration', () => {
    const root = fakePackage({ ...VECTOR_ORB, registry: undefined, source: 'behaviors/lolo' }, ['behaviors/lolo/a.lolo']);
    const pkg = readBehaviorPackage(root);
    expect(behaviorSourceTree(pkg)).toEqual({ dir: join(root, 'behaviors/lolo'), extension: '.lolo' });
    expect(pkg.orb.vectors).toBe('dist/vectors.vec');
  });

  it('keeps the materialized registry ahead of source when both are declared with vectors', () => {
    const root = fakePackage({ ...VECTOR_ORB, source: 'behaviors/lolo' }, ['behaviors/registry/a.orb', 'behaviors/lolo/a.lolo']);
    expect(behaviorSourceTree(readBehaviorPackage(root))).toEqual({ dir: join(root, 'behaviors/registry'), extension: '.orb' });
  });
});

describe('resolveDeclaredFile', () => {
  it('resolves a declared single-file key to an absolute path that exists', () => {
    const root = fakePackage(VECTOR_ORB, ['dist/vectors.vec']);
    const file = resolveDeclaredFile(readBehaviorPackage(root), 'vectors');
    expect(file).toBe(join(root, 'dist/vectors.vec'));
  });

  it('resolves the registry directory key', () => {
    const root = fakePackage(ORB, ['behaviors/registry/app/atoms/x.orb']);
    expect(behaviorRegistryDir(readBehaviorPackage(root))).toBe(join(root, 'behaviors/registry'));
  });

  it('fails when the declared file is missing — no layout guess, no fallback copy', () => {
    const root = fakePackage(VECTOR_ORB, []);
    expect(() => resolveDeclaredFile(readBehaviorPackage(root), 'vectors')).toThrow(/orb\.vectors/);
  });

  it('refuses a declared path that escapes the package root', () => {
    const root = fakePackage({ ...ORB, vectors: '../outside.vec' }, []);
    expect(() => resolveDeclaredFile(readBehaviorPackage(root), 'vectors')).toThrow(/outside the package/);
  });

  it('resolves the explicit vectors path through the existing declared-file resolver', () => {
    const root = fakePackage(VECTOR_ORB, ['dist/vectors.vec']);
    expect(resolveDeclaredFile(readBehaviorPackage(root), 'vectors')).toBe(join(root, 'dist/vectors.vec'));
  });

  it('refuses undeclared vectors even when the conventional snapshot file exists', () => {
    const root = fakePackage(ORB, ['dist/vectors.vec']);
    expect(() => resolveDeclaredFile(readBehaviorPackage(root), 'vectors')).toThrow(/orb\.vectors.*not declared/);
  });

  it('refuses a missing declared snapshot without guessing a different vector path', () => {
    const root = fakePackage({ ...VECTOR_ORB, vectors: 'custom/package.vec' }, ['dist/vectors.vec']);
    expect(() => resolveDeclaredFile(readBehaviorPackage(root), 'vectors')).toThrow(/orb\.vectors.*custom\/package\.vec/);
  });

  it('refuses a vectors path that escapes the package root', () => {
    const root = fakePackage({ ...VECTOR_ORB, vectors: '../outside.vec' }, []);
    expect(() => resolveDeclaredFile(readBehaviorPackage(root), 'vectors')).toThrow(/outside the package/);
  });
});

describe('behaviorProgramFiles', () => {
  const declared = ['dist/behaviors-registry.json', 'behaviors/signatures.lolo', 'dist/behaviors-embeddings.json'];

  it('maps every program under the registry, nested folders included, to its file by basename', () => {
    const root = fakePackage(ORB, [...declared, 'behaviors/registry/app/atoms/std-a.orb', 'behaviors/registry/websites/atoms/blog/std-b.orb', 'behaviors/registry/ui/core/templates/ui-c.orb']);
    const files = behaviorProgramFiles(readBehaviorPackage(root));
    expect([...files.keys()].sort()).toEqual(['std-a', 'std-b', 'ui-c']);
    expect(files.get('std-b')).toBe(join(root, 'behaviors/registry/websites/atoms/blog/std-b.orb'));
  });

  it('control: files that are not programs are not behaviors', () => {
    const root = fakePackage(ORB, [...declared, 'behaviors/registry/app/atoms/std-a.orb', 'behaviors/registry/notes.json', 'behaviors/registry/app/atoms/README.md']);
    expect([...behaviorProgramFiles(readBehaviorPackage(root)).keys()]).toEqual(['std-a']);
  });

  it('edge: two programs with one name are refused, naming both files', () => {
    const root = fakePackage(ORB, [...declared, 'behaviors/registry/app/atoms/std-a.orb', 'behaviors/registry/game/atoms/std-a.orb']);
    expect(() => behaviorProgramFiles(readBehaviorPackage(root))).toThrow(/std-a.*app\/atoms.*game\/atoms|std-a.*game\/atoms.*app\/atoms/);
  });
});
