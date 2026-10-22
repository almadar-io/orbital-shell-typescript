import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BehaviorPackageError,
  ensureDeclaredPath,
  readBehaviorPackage,
  resolveDeclaredFile,
  resolveDeclaredPath,
  type BehaviorPackageOrbBlock,
  type SidecarFetch,
} from '../src/behavior-package.js';

const ORB = {
  prefix: 'almadar-test',
  registry: 'behaviors/registry',
  embeddings: ['dist/behaviors-embeddings.json', 'dist/knob-embeddings.json'],
  compiler: '>=4.10.0',
};

const CONTENT = '{"vectors":{"k":{"s":1,"d":"AA=="}}}';
const SHA = createHash('sha256').update(CONTENT).digest('hex');
const URL_ = 'https://storage.example/sidecars/abc?token=t';

function pkgWithLock(lockFiles: Record<string, { sha256: string; bytes: number; url: string }> | 'malformed', files: string[] = [], orb: BehaviorPackageOrbBlock = ORB): string {
  const root = mkdtempSync(join(tmpdir(), 'sidecar-pkg-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@test/pkg', version: '1.0.0', orb }));
  writeFileSync(join(root, 'sidecars.lock.json'), lockFiles === 'malformed' ? '{"version":1,"files":{"x":{}}}' : JSON.stringify({ version: 1, files: lockFiles }));
  for (const rel of files) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), '{}');
  }
  return root;
}

const freshCache = (): string => mkdtempSync(join(tmpdir(), 'sidecar-cache-'));

function fakeFetch(body: string, calls: string[]): SidecarFetch {
  return async (url) => {
    calls.push(url);
    return new Uint8Array(Buffer.from(body));
  };
}

const LOCKED = { 'dist/knob-embeddings.json': { sha256: SHA, bytes: Buffer.byteLength(CONTENT), url: URL_ } };

describe('lock-declared vectors', () => {
  const vectors = 'dist/vectors.vec';
  const orb = { prefix: ORB.prefix, registry: ORB.registry, compiler: ORB.compiler, vectors };
  const locked = { [vectors]: { sha256: SHA, bytes: Buffer.byteLength(CONTENT), url: URL_ } };

  it('uses the declared lock and existing resolver with no package snapshot', async () => {
    const cache = freshCache();
    const calls: string[] = [];
    const root = pkgWithLock(locked, [], orb);
    const pkg = readBehaviorPackage(root);
    expect(existsSync(join(root, vectors))).toBe(false);
    expect(() => resolveDeclaredFile(pkg, 'vectors', { cacheDir: cache })).toThrow(/ORB_SIDECAR_NOT_CACHED/);
    await ensureDeclaredPath(pkg, vectors, { cacheDir: cache, fetch: fakeFetch(CONTENT, calls) });
    expect(resolveDeclaredFile(pkg, 'vectors', { cacheDir: cache })).toBe(join(cache, SHA));
    expect(calls).toEqual([URL_]);
  });

  it('keeps lock precedence when the package also holds a vectors file', () => {
    const cache = freshCache();
    writeFileSync(join(cache, SHA), CONTENT);
    const pkg = readBehaviorPackage(pkgWithLock(locked, [vectors], orb));
    expect(resolveDeclaredFile(pkg, 'vectors', { cacheDir: cache })).toBe(join(cache, SHA));
  });

  it('does not use an unrelated lock entry to satisfy a missing declared snapshot', () => {
    const pkg = readBehaviorPackage(pkgWithLock(LOCKED, [], orb));
    expect(() => resolveDeclaredFile(pkg, 'vectors', { cacheDir: freshCache() })).toThrow(/orb\.vectors.*not in the package/);
  });
});

describe('lock-declared sidecars', () => {
  it('cache miss: downloads, verifies sha256, stores at <cache>/<sha256>', async () => {
    const calls: string[] = [];
    const cache = freshCache();
    const pkg = readBehaviorPackage(pkgWithLock(LOCKED));
    const file = await ensureDeclaredPath(pkg, 'dist/knob-embeddings.json', { cacheDir: cache, fetch: fakeFetch(CONTENT, calls) });
    expect(file).toBe(join(cache, SHA));
    expect(readFileSync(file, 'utf8')).toBe(CONTENT);
    expect(calls).toEqual([URL_]);
  });

  it('cache hit: no download', async () => {
    const calls: string[] = [];
    const cache = freshCache();
    writeFileSync(join(cache, SHA), CONTENT);
    const pkg = readBehaviorPackage(pkgWithLock(LOCKED));
    const file = await ensureDeclaredPath(pkg, 'dist/knob-embeddings.json', { cacheDir: cache, fetch: fakeFetch(CONTENT, calls) });
    expect(file).toBe(join(cache, SHA));
    expect(calls).toEqual([]);
  });

  it('hash mismatch: fails and leaves nothing in the cache', async () => {
    const cache = freshCache();
    const pkg = readBehaviorPackage(pkgWithLock(LOCKED));
    await expect(ensureDeclaredPath(pkg, 'dist/knob-embeddings.json', { cacheDir: cache, fetch: fakeFetch('tampered', []) })).rejects.toThrow(/ORB_SIDECAR_HASH_MISMATCH/);
    expect(existsSync(join(cache, SHA))).toBe(false);
  });

  it('a cached file of the wrong size fails — never served', async () => {
    const cache = freshCache();
    writeFileSync(join(cache, SHA), 'short');
    const pkg = readBehaviorPackage(pkgWithLock(LOCKED));
    await expect(ensureDeclaredPath(pkg, 'dist/knob-embeddings.json', { cacheDir: cache, fetch: fakeFetch(CONTENT, []) })).rejects.toThrow(/ORB_SIDECAR_HASH_MISMATCH/);
  });

  it('a download failure fails loudly, naming the path and the url host, never the token', async () => {
    const cache = freshCache();
    const pkg = readBehaviorPackage(pkgWithLock(LOCKED));
    const failing: SidecarFetch = async () => {
      throw new Error('network down');
    };
    const err = await ensureDeclaredPath(pkg, 'dist/knob-embeddings.json', { cacheDir: cache, fetch: failing }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(BehaviorPackageError);
    expect(String(err)).toMatch(/ORB_SIDECAR_FETCH_FAILED/);
    expect(String(err)).toMatch(/storage\.example/);
    expect(String(err)).not.toMatch(/token=t/);
  });

  it('a path not in the lock is read from the package', async () => {
    const root = pkgWithLock(LOCKED, ['dist/behaviors-embeddings.json']);
    const pkg = readBehaviorPackage(root);
    const file = await ensureDeclaredPath(pkg, 'dist/behaviors-embeddings.json', { cacheDir: freshCache(), fetch: fakeFetch('', []) });
    expect(file).toBe(join(root, 'dist/behaviors-embeddings.json'));
  });

  it('a path not in the lock and missing from the package fails', async () => {
    const pkg = readBehaviorPackage(pkgWithLock({}));
    await expect(ensureDeclaredPath(pkg, 'dist/behaviors-embeddings.json', { cacheDir: freshCache(), fetch: fakeFetch('', []) })).rejects.toThrow(/not in the package/);
  });

  it('a malformed lock is refused', () => {
    const root = pkgWithLock('malformed');
    expect(() => readBehaviorPackage(root)).toThrow(/sidecars\.lock\.json/);
  });

  it('sync resolution of a lock-declared path that is not cached yet fails with ORB_SIDECAR_NOT_CACHED', () => {
    const pkg = readBehaviorPackage(pkgWithLock(LOCKED));
    expect(() => resolveDeclaredPath(pkg, 'dist/knob-embeddings.json', { cacheDir: freshCache() })).toThrow(/ORB_SIDECAR_NOT_CACHED/);
  });

  it('sync resolution of a cached lock-declared path returns the cache file', () => {
    const cache = freshCache();
    writeFileSync(join(cache, SHA), CONTENT);
    const pkg = readBehaviorPackage(pkgWithLock(LOCKED));
    expect(resolveDeclaredPath(pkg, 'dist/knob-embeddings.json', { cacheDir: cache })).toBe(join(cache, SHA));
  });
});
