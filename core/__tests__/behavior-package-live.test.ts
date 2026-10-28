import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  behaviorRegistryDir,
  behaviorSourceTree,
  evictOldMirrors,
  materializeRegistry,
  pruneRegistryMirrors,
  readBehaviorPackage,
  REGISTRY_MIRROR_LIMIT,
} from '../src/behavior-package.js';

/**
 * A stand-in `orb`: `--version` prints a version; `lower <files…>` appends one
 * line per call to `calls.log` (the files it was asked for) and prints the NDJSON
 * contract, failing any file whose content contains `BROKEN`.
 */
function fakeOrb(dir: string): string {
  const bin = join(dir, 'orb');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('orb 9.9.9'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(join(dir, 'calls.log'))}, args.slice(1).map((f) => require('path').basename(f)).join(',') + '\\n');
for (const f of args.slice(1)) {
  const text = fs.readFileSync(f, 'utf8');
  console.log(JSON.stringify(text.includes('BROKEN') ? { path: f, error: 'parse error' } : { path: f, orb: { name: text.trim() } }));
}
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

function livePackage(files: Record<string, string>): { root: string; work: string } {
  const work = mkdtempSync(join(tmpdir(), 'live-registry-'));
  const root = join(work, 'pkg');
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: '@test/live',
      version: '1.0.0',
      orb: { prefix: 'test', source: 'behaviors/lolo', index: 'i.json', embeddings: [], compiler: '>=1.0.0' },
    }),
  );
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, 'behaviors/lolo', rel, '..'), { recursive: true });
    writeFileSync(join(root, 'behaviors/lolo', rel), body);
  }
  return { root, work };
}

const calls = (work: string): string[] => (existsSync(join(work, 'calls.log')) ? readFileSync(join(work, 'calls.log'), 'utf8').trim().split('\n') : []);

describe('behaviorRegistryDir — a live package (orb.source)', () => {
  it('lowers every .lolo into a mirror with the registry layout', () => {
    const { root, work } = livePackage({ 'app/atoms/a.lolo': 'A', 'app/organisms/b.lolo': 'B' });
    const dir = behaviorRegistryDir(readBehaviorPackage(root), { orbBin: fakeOrb(work), cacheDir: join(work, 'cache') });
    expect(JSON.parse(readFileSync(join(dir, 'app/atoms/a.orb'), 'utf8'))).toEqual({ name: 'A' });
    expect(JSON.parse(readFileSync(join(dir, 'app/organisms/b.orb'), 'utf8'))).toEqual({ name: 'B' });
  });

  it('a second call with nothing changed lowers nothing; an edit re-lowers only that file', () => {
    const { root, work } = livePackage({ 'app/atoms/a.lolo': 'A', 'app/atoms/b.lolo': 'B' });
    const opts = { orbBin: fakeOrb(work), cacheDir: join(work, 'cache') };
    const pkg = readBehaviorPackage(root);
    behaviorRegistryDir(pkg, opts);
    behaviorRegistryDir(pkg, opts);
    expect(calls(work)).toEqual(['a.lolo,b.lolo']);
    writeFileSync(join(root, 'behaviors/lolo/app/atoms/b.lolo'), 'B2');
    const dir = behaviorRegistryDir(pkg, opts);
    expect(calls(work)).toEqual(['a.lolo,b.lolo', 'b.lolo']);
    expect(JSON.parse(readFileSync(join(dir, 'app/atoms/b.orb'), 'utf8'))).toEqual({ name: 'B2' });
  });

  it('a rebuilt orb with the same version string re-lowers everything', () => {
    const { root, work } = livePackage({ 'app/atoms/a.lolo': 'A' });
    const opts = { orbBin: fakeOrb(work), cacheDir: join(work, 'cache') };
    const pkg = readBehaviorPackage(root);
    behaviorRegistryDir(pkg, opts);
    writeFileSync(opts.orbBin, `${readFileSync(opts.orbBin, 'utf8')}\n// rebuilt\n`);
    behaviorRegistryDir(pkg, opts);
    expect(calls(work)).toEqual(['a.lolo', 'a.lolo']);
  });

  it('a change to the installed core language data re-lowers everything', () => {
    const { root, work } = livePackage({ 'app/atoms/a.lolo': 'A' });
    const core = join(work, 'node_modules/@almadar/core');
    mkdirSync(core, { recursive: true });
    writeFileSync(join(core, 'package.json'), JSON.stringify({ name: '@almadar/core', version: '1.0.0', orbLanguage: { compiler: '>=1.0.0', patterns: 'p.json' } }));
    writeFileSync(join(core, 'p.json'), '{"patterns":{}}');
    const opts = { orbBin: fakeOrb(work), cacheDir: join(work, 'cache') };
    const pkg = readBehaviorPackage(root);
    behaviorRegistryDir(pkg, opts);
    behaviorRegistryDir(pkg, opts);
    writeFileSync(join(core, 'p.json'), '{"patterns":{"new-pattern":{}}}');
    behaviorRegistryDir(pkg, opts);
    expect(calls(work)).toEqual(['a.lolo', 'a.lolo']);
  });

  it('a removed .lolo is pruned from the mirror', () => {
    const { root, work } = livePackage({ 'app/atoms/a.lolo': 'A', 'app/atoms/gone.lolo': 'G' });
    const opts = { orbBin: fakeOrb(work), cacheDir: join(work, 'cache') };
    const pkg = readBehaviorPackage(root);
    behaviorRegistryDir(pkg, opts);
    rmSync(join(root, 'behaviors/lolo/app/atoms/gone.lolo'));
    const dir = behaviorRegistryDir(pkg, opts);
    expect(existsSync(join(dir, 'app/atoms/gone.orb'))).toBe(false);
    expect(existsSync(join(dir, 'app/atoms/a.orb'))).toBe(true);
  });

  it('a behavior message catalog is mirrored beside its program, and an edit to it is seen', () => {
    const { root, work } = livePackage({ 'kflow/atoms/a.lolo': 'A', 'kflow/atoms/locales/en/a.json': '{"t":"Hi"}' });
    const opts = { orbBin: fakeOrb(work), cacheDir: join(work, 'cache') };
    const pkg = readBehaviorPackage(root);
    let dir = behaviorRegistryDir(pkg, opts);
    expect(readFileSync(join(dir, 'kflow/atoms/locales/en/a.json'), 'utf8')).toBe('{"t":"Hi"}');
    writeFileSync(join(root, 'behaviors/lolo/kflow/atoms/locales/en/a.json'), '{"t":"Hello"}');
    dir = behaviorRegistryDir(pkg, opts);
    expect(readFileSync(join(dir, 'kflow/atoms/locales/en/a.json'), 'utf8')).toBe('{"t":"Hello"}');
    expect(calls(work)).toEqual(['a.lolo']);
  });

  it('a removed catalog is pruned; control: json outside locales/ is not mirrored', () => {
    const { root, work } = livePackage({
      'kflow/atoms/a.lolo': 'A',
      'kflow/atoms/locales/en/a.json': '{}',
      'kflow/.hand-authored.json': '[]',
    });
    const opts = { orbBin: fakeOrb(work), cacheDir: join(work, 'cache') };
    const pkg = readBehaviorPackage(root);
    behaviorRegistryDir(pkg, opts);
    rmSync(join(root, 'behaviors/lolo/kflow/atoms/locales/en/a.json'));
    const dir = behaviorRegistryDir(pkg, opts);
    expect(existsSync(join(dir, 'kflow/atoms/locales/en/a.json'))).toBe(false);
    expect(existsSync(join(dir, 'kflow/.hand-authored.json'))).toBe(false);
  });

  it('a file that does not lower fails the call, naming it', () => {
    const { root, work } = livePackage({ 'app/atoms/bad.lolo': 'BROKEN' });
    expect(() => behaviorRegistryDir(readBehaviorPackage(root), { orbBin: fakeOrb(work), cacheDir: join(work, 'cache') })).toThrow(
      /bad\.lolo does not lower: parse error/,
    );
  });

  it('control: a package declaring a registry is read as-is, with no orb call', () => {
    const { root, work } = livePackage({});
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.orb.registry = 'behaviors/registry';
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
    mkdirSync(join(root, 'behaviors/registry'), { recursive: true });
    expect(behaviorRegistryDir(readBehaviorPackage(root), { orbBin: fakeOrb(work), cacheDir: join(work, 'cache') })).toBe(join(root, 'behaviors/registry'));
    expect(calls(work)).toEqual([]);
  });

  it('edge: a manifest declaring neither registry nor source is refused at read', () => {
    const { root } = livePackage({});
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    delete manifest.orb.source;
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
    expect(() => readBehaviorPackage(root)).toThrow(/neither `registry`/);
  });
});

describe('materializeRegistry — publishing a live package', () => {
  /** `lower` as in fakeOrb; `emit orb <lolo> --output <out>` writes the program plus a merged `<stem>.en.json` catalog. */
  function publishOrb(dir: string): string {
    const bin = join(dir, 'orb');
    writeFileSync(
      bin,
      `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('orb 9.9.9'); process.exit(0); }
const program = (f) => { const t = fs.readFileSync(f, 'utf8').trim(); return t.startsWith('{') ? JSON.parse(t) : { name: t }; };
if (args[0] === 'lower') { for (const f of args.slice(1)) console.log(JSON.stringify({ path: f, orb: program(f) })); process.exit(0); }
if (args[0] === 'emit') {
  fs.appendFileSync(${JSON.stringify(join(dir, 'emits.log'))}, path.basename(args[2]) + '\\n');
  const out = args[args.indexOf('--output') + 1];
  fs.writeFileSync(out, JSON.stringify(program(args[2])));
  fs.writeFileSync(out.replace(/\\.orb$/, '.en.json'), '{"site:title":"Hi"}');
  process.exit(0);
}
process.exit(2);
`,
    );
    chmodSync(bin, 0o755);
    return bin;
  }

  it('writes every lowered program into behaviors/registry and returns the block declaring it', () => {
    const { root, work } = livePackage({ 'app/atoms/a.lolo': 'A', 'kflow/atoms/site.lolo': '{"name":"site","locales":["en"]}', 'kflow/atoms/locales/en/site.json': '{"title":"Hi"}' });
    mkdirSync(join(root, 'behaviors/registry'), { recursive: true });
    writeFileSync(join(root, 'behaviors/registry/notes.json'), '{"keep":true}');
    const orb = materializeRegistry(readBehaviorPackage(root), { orbBin: publishOrb(work), cacheDir: join(work, 'cache') });
    expect(orb.registry).toBe('behaviors/registry');
    expect(orb.source).toBe('behaviors/lolo');
    expect(JSON.parse(readFileSync(join(root, 'behaviors/registry/app/atoms/a.orb'), 'utf8'))).toEqual({ name: 'A' });
    expect(readFileSync(join(root, 'behaviors/registry/kflow/atoms/locales/en/site.json'), 'utf8')).toBe('{"title":"Hi"}');
    expect(readFileSync(join(root, 'behaviors/registry/kflow/atoms/site.en.json'), 'utf8')).toBe('{"site:title":"Hi"}');
    expect(readFileSync(join(root, 'behaviors/registry/notes.json'), 'utf8')).toBe('{"keep":true}');
    expect(readFileSync(join(work, 'emits.log'), 'utf8').trim().split('\n')).toEqual(['site.lolo']);
  });

  it('control: a package that already declares a registry is refused, not re-materialized', () => {
    const { root, work } = livePackage({});
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.orb.registry = 'behaviors/registry';
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
    mkdirSync(join(root, 'behaviors/registry'), { recursive: true });
    expect(() => materializeRegistry(readBehaviorPackage(root), { orbBin: publishOrb(work), cacheDir: join(work, 'cache') })).toThrow(/already declares/);
  });
});

describe('pruneRegistryMirrors — dropping mirrors no current package uses', () => {
  it('removes every mirror but the current packages’ own; control: the current one survives and still serves', () => {
    const { root, work } = livePackage({ 'app/atoms/a.lolo': 'A' });
    const opts = { orbBin: fakeOrb(work), cacheDir: join(work, 'cache') };
    const pkg = readBehaviorPackage(root);
    const current = behaviorRegistryDir(pkg, opts);
    const stale = join(work, 'cache', 'registry', 'stale-orb-version');
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, 'x.orb'), '{}');
    const removed = pruneRegistryMirrors([pkg], opts);
    expect(removed).toEqual([stale]);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(current, 'app/atoms/a.orb'))).toBe(true);
  });

  it('edge: a materialized package keeps nothing in the cache, so every mirror is stale', () => {
    const { root, work } = livePackage({});
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.orb.registry = 'behaviors/registry';
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
    mkdirSync(join(root, 'behaviors/registry'), { recursive: true });
    const old = join(work, 'cache', 'registry', 'old');
    mkdirSync(old, { recursive: true });
    expect(pruneRegistryMirrors([readBehaviorPackage(root)], { orbBin: fakeOrb(work), cacheDir: join(work, 'cache') })).toEqual([old]);
  });
});

describe('behaviorSourceTree — the files a package authors its behaviors in', () => {
  it('a live package is its .lolo source tree, with no orb call', () => {
    const { root, work } = livePackage({ 'app/atoms/a.lolo': 'A' });
    expect(behaviorSourceTree(readBehaviorPackage(root))).toEqual({ dir: join(root, 'behaviors/lolo'), extension: '.lolo' });
    expect(calls(work)).toEqual([]);
  });

  it('control: a materialized package is its declared registry of .orb programs', () => {
    const { root } = livePackage({});
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.orb.registry = 'behaviors/registry';
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
    mkdirSync(join(root, 'behaviors/registry'), { recursive: true });
    expect(behaviorSourceTree(readBehaviorPackage(root))).toEqual({ dir: join(root, 'behaviors/registry'), extension: '.orb' });
  });
});

describe('derived registry mirrors are bounded', () => {
  const seedMirrors = (root: string, count: number, firstAge: number): string[] => {
    mkdirSync(root, { recursive: true });
    return Array.from({ length: count }, (_, i) => {
      const dir = join(root, `m${String(i).padStart(2, '0')}`);
      mkdirSync(dir);
      writeFileSync(join(dir, 'x.orb'), '{}');
      const at = new Date(Date.now() - (firstAge - i) * 60_000);
      utimesSync(dir, at, at);
      return dir;
    });
  };
  const names = (root: string): string[] => readdirSync(root).sort();

  it('keeps exactly the limit, the most recently used', () => {
    const root = mkdtempSync(join(tmpdir(), 'mirrors-'));
    const dirs = seedMirrors(root, REGISTRY_MIRROR_LIMIT + 4, 100);
    const removed = evictOldMirrors(root, new Set());
    expect(removed).toEqual(dirs.slice(0, 4));
    expect(names(root)).toEqual(dirs.slice(4).map((d) => d.slice(root.length + 1)));
    expect(names(root)).toHaveLength(REGISTRY_MIRROR_LIMIT);
  });

  it('control: at or under the limit nothing is removed', () => {
    const root = mkdtempSync(join(tmpdir(), 'mirrors-'));
    seedMirrors(root, REGISTRY_MIRROR_LIMIT, 100);
    expect(evictOldMirrors(root, new Set())).toEqual([]);
    expect(names(root)).toHaveLength(REGISTRY_MIRROR_LIMIT);
  });

  it('never removes a protected mirror, even the oldest', () => {
    const root = mkdtempSync(join(tmpdir(), 'mirrors-'));
    const dirs = seedMirrors(root, REGISTRY_MIRROR_LIMIT + 2, 100);
    const removed = evictOldMirrors(root, new Set([dirs[0]!]));
    expect(removed).toEqual([dirs[1]]);
    expect(existsSync(dirs[0]!)).toBe(true);
  });

  it('ties in use time resolve by name, the same way every run', () => {
    const root = mkdtempSync(join(tmpdir(), 'mirrors-'));
    const dirs = seedMirrors(root, REGISTRY_MIRROR_LIMIT + 1, 0);
    const at = new Date(Date.now() - 60_000);
    for (const dir of dirs) utimesSync(dir, at, at);
    expect(evictOldMirrors(root, new Set())).toEqual([dirs[REGISTRY_MIRROR_LIMIT]]);
  });

  it('a missing registry root is not an error', () => {
    expect(evictOldMirrors(join(tmpdir(), 'no-such-mirrors-root'), new Set())).toEqual([]);
  });

  it('reading a new revision keeps the limit and the revision it just wrote', () => {
    const { root, work } = livePackage({ 'app/atoms/a.lolo': 'A' });
    const cache = join(work, 'cache');
    const stale = seedMirrors(join(cache, 'registry'), REGISTRY_MIRROR_LIMIT + 3, 100);
    const dir = behaviorRegistryDir(readBehaviorPackage(root), { orbBin: fakeOrb(work), cacheDir: cache });
    expect(existsSync(join(dir, 'app/atoms/a.orb'))).toBe(true);
    const left = readdirSync(join(cache, 'registry'));
    expect(left).toHaveLength(REGISTRY_MIRROR_LIMIT);
    expect(left).toContain(dir.slice(dir.lastIndexOf('/') + 1));
    expect(existsSync(stale[0]!)).toBe(false);
    expect(existsSync(stale[REGISTRY_MIRROR_LIMIT + 2]!)).toBe(true);
  });
});
